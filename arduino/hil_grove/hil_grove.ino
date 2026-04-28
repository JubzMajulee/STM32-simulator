// HIL Grove sketch — Arduino Uno + Grove Beginner Kit
//
// OLED is currently disabled because U8g2's begin() hangs when the SSD1315 on
// some Grove Beginner Kit revisions doesn't ACK on I2C. The pot + LED + serial
// protocol still work without it. Re-enable the OLED block at the bottom of
// this file once you've verified the display responds (e.g. with an I2C
// scanner sketch).
//
// Pins (default Grove Beginner Kit wiring):
//   - Rotary potentiometer .... A0
//   - Onboard LED ............. D4
//   - OLED display ............ I2C (SDA = A4, SCL = A5)  [disabled]
//
// Serial protocol (115200 baud, newline-terminated):
//   Outbound (Arduino → bridge):
//     RPT:TEMP:<float>       periodic temperature report
//     ACK:LIGHT:ON|OFF       confirmation after a light command
//   Inbound (bridge → Arduino):
//     SET:TEST:ON|OFF        switch between potentiometer and fixed test value
//     SET:VAL:<float>        set the fixed test value (also enables test mode)
//     CMD:LIGHT:ON|OFF|TOGGLE control the LED

const int POT_PIN = A0;
const int LED_PIN = 4;

bool  testMode      = false;
float testValue     = 25.0;
bool  ledOn         = false;
float lastSentTemp  = -999.0;
unsigned long lastReportMs = 0;
const unsigned long REPORT_MIN_INTERVAL_MS = 200;
const unsigned long REPORT_HEARTBEAT_MS    = 1000;

String inputBuffer = "";

float readPotTemp() {
  int raw = analogRead(POT_PIN);
  return raw * (150.0f / 1023.0f);  // map 0–1023 to 0–150 °C
}

void sendLine(const String& line) {
  Serial.println(line);
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  if (cmd == "SET:TEST:ON") {
    testMode = true;
  } else if (cmd == "SET:TEST:OFF") {
    testMode = false;
  } else if (cmd.startsWith("SET:VAL:")) {
    testValue = cmd.substring(8).toFloat();
    if (!testMode) testMode = true;
  } else if (cmd == "CMD:LIGHT:ON") {
    ledOn = true;
    digitalWrite(LED_PIN, HIGH);
    sendLine("ACK:LIGHT:ON");
  } else if (cmd == "CMD:LIGHT:OFF") {
    ledOn = false;
    digitalWrite(LED_PIN, LOW);
    sendLine("ACK:LIGHT:OFF");
  } else if (cmd == "CMD:LIGHT:TOGGLE") {
    ledOn = !ledOn;
    digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
    sendLine(ledOn ? "ACK:LIGHT:ON" : "ACK:LIGHT:OFF");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
}

void loop() {
  // Drain serial input one line at a time
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (inputBuffer.length() > 0) {
        handleCommand(inputBuffer);
        inputBuffer = "";
      }
    } else {
      inputBuffer += c;
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
    sendLine("RPT:TEMP:" + String(currentTemp, 1));
    lastSentTemp = currentTemp;
    lastReportMs = now;
  }
}

// ----------------------------------------------------------------------------
// OLED block — re-enable once your display ACKs on I2C.
//
// 1. #include <U8g2lib.h>  // and <Wire.h>
// 2. Declare the driver:
//      U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);
// 3. Add to setup():
//      oled.begin();
// 4. Re-add a displayUpdate() call to loop() (~10 Hz) and restore the body
//    that draws temp + LED state with u8g2_font_logisoso24_tr.
// ----------------------------------------------------------------------------
