// HIL Grove sketch — Arduino Uno + Grove Beginner Kit
//
// Library required (install via Arduino IDE → Library Manager):
//   - U8g2 by olikraus
//
// Pins (default Grove Beginner Kit wiring):
//   - Rotary potentiometer .... A0
//   - Onboard LED ............. D4
//   - OLED display ............ I2C (SDA = A4, SCL = A5)
//
// Memory notes:
//   - U8g2 in page-buffer mode (the "_1_" suffix) so the OLED costs ~128 B
//     instead of ~1 KB; full buffer left no SRAM headroom on the Uno.
//   - All Serial strings are kept in flash via F() and we use a fixed char[]
//     for the input buffer — no String, no heap fragmentation.
//   - I2C bus is forced to 100 kHz; SSD1315 hangs U8g2's begin() at 400 kHz.
//
// Serial protocol (115200 baud, newline-terminated):
//   Outbound (Arduino → bridge):
//     RPT:TEMP:<float>       periodic temperature report
//     ACK:LIGHT:ON|OFF       confirmation after a light command
//   Inbound (bridge → Arduino):
//     SET:TEST:ON|OFF        switch between potentiometer and fixed test value
//     SET:VAL:<float>        set the fixed test value (also enables test mode)
//     CMD:LIGHT:ON|OFF|TOGGLE control the LED

#include <U8g2lib.h>
#include <Wire.h>

const int POT_PIN = A0;
const int LED_PIN = 4;

U8G2_SSD1306_128X64_NONAME_1_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

bool  testMode     = false;
float testValue    = 25.0;
bool  ledOn        = false;
float lastSentTemp = -999.0;
unsigned long lastReportMs  = 0;
unsigned long lastDisplayMs = 0;
const unsigned long REPORT_MIN_INTERVAL_MS = 200;
const unsigned long REPORT_HEARTBEAT_MS    = 1000;
const unsigned long DISPLAY_INTERVAL_MS    = 200;

char inputBuffer[48];
byte inputLen = 0;

float readPotTemp() {
  int raw = analogRead(POT_PIN);
  return raw * (150.0f / 1023.0f);  // 0–1023 → 0–150 °C
}

void displayUpdate(float temp) {
  char tempBuf[10];
  dtostrf(temp, 4, 1, tempBuf);

  oled.firstPage();
  do {
    oled.setFont(u8g2_font_6x12_tr);
    oled.drawStr(0, 10, "HIL SENSOR");
    oled.drawStr(96, 10, testMode ? "TEST" : "LIVE");

    oled.setFont(u8g2_font_logisoso24_tr);
    oled.drawStr(0, 44, tempBuf);

    oled.drawCircle(95, 22, 2);
    oled.setFont(u8g2_font_6x12_tr);
    oled.drawStr(102, 32, "C");

    oled.drawStr(0, 62, ledOn ? "LED: ON" : "LED: OFF");
  } while (oled.nextPage());
}

void sendRpt(float val) {
  Serial.print(F("RPT:TEMP:"));
  Serial.println(val, 1);
}

void sendAck(bool on) {
  Serial.println(on ? F("ACK:LIGHT:ON") : F("ACK:LIGHT:OFF"));
}

void handleCommand(const char* cmd) {
  if (strcmp(cmd, "SET:TEST:ON") == 0) {
    testMode = true;
  } else if (strcmp(cmd, "SET:TEST:OFF") == 0) {
    testMode = false;
  } else if (strncmp(cmd, "SET:VAL:", 8) == 0) {
    testValue = atof(cmd + 8);
    if (!testMode) testMode = true;
  } else if (strcmp(cmd, "CMD:LIGHT:ON") == 0) {
    ledOn = true;
    digitalWrite(LED_PIN, HIGH);
    sendAck(true);
  } else if (strcmp(cmd, "CMD:LIGHT:OFF") == 0) {
    ledOn = false;
    digitalWrite(LED_PIN, LOW);
    sendAck(false);
  } else if (strcmp(cmd, "CMD:LIGHT:TOGGLE") == 0) {
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
    sendAck(ledOn);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Wire.begin();
  Wire.setClock(100000);
  oled.setBusClock(100000);
  oled.setI2CAddress(0x3C << 1);
  oled.begin();
}

void loop() {
  // Drain serial input one line at a time
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inputLen > 0) {
        inputBuffer[inputLen] = '\0';
        handleCommand(inputBuffer);
        inputLen = 0;
      }
    } else if (inputLen < sizeof(inputBuffer) - 1) {
      inputBuffer[inputLen++] = c;
    }
  }

  float currentTemp = testMode ? testValue : readPotTemp();

  unsigned long now = millis();
  bool significant      = abs(currentTemp - lastSentTemp) > 0.3;
  bool thresholdCross   = (currentTemp > 100 && lastSentTemp <= 100) ||
                          (currentTemp <= 100 && lastSentTemp > 100);
  bool intervalElapsed  = (now - lastReportMs) >= REPORT_MIN_INTERVAL_MS;
  bool heartbeatElapsed = (now - lastReportMs) >= REPORT_HEARTBEAT_MS;

  if ((intervalElapsed && (significant || thresholdCross)) || heartbeatElapsed) {
    sendRpt(currentTemp);
    lastSentTemp = currentTemp;
    lastReportMs = now;
  }

  if (now - lastDisplayMs >= DISPLAY_INTERVAL_MS) {
    displayUpdate(currentTemp);
    lastDisplayMs = now;
  }
}
