// Standalone OLED test — confirms the SSD1306-class display on Grove Beginner
// Kit responds correctly. Default I2C clock is dropped to 100 kHz which most
// SSD1315 clones tolerate, the default 400 kHz is what makes them hang.
//
// Open Serial Monitor at 115200 baud after upload. You should see:
//   "before begin"
//   "after begin"
//   "drawn"
// and the OLED should display "HIL TEST".
//
// If you only see "before begin" and the OLED stays blank, try uncommenting
// the SH1106 line below and re-upload — some Grove BK revisions ship that
// chip instead of SSD1315.

#include <U8g2lib.h>
#include <Wire.h>

// Default candidate (SSD1306-compatible — covers SSD1315 most of the time).
U8G2_SSD1306_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

// Fallback candidate — comment out the line above and uncomment this one if
// the default hangs.
// U8G2_SH1106_128X64_NONAME_F_HW_I2C oled(U8G2_R0, U8X8_PIN_NONE);

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("before begin");

  Wire.begin();
  Wire.setClock(100000);             // 100 kHz instead of 400 kHz default
  oled.setBusClock(100000);          // tell U8g2 not to bump it back up
  oled.setI2CAddress(0x3C << 1);
  oled.begin();
  Serial.println("after begin");

  oled.clearBuffer();
  oled.setFont(u8g2_font_logisoso24_tr);
  oled.drawStr(0, 30, "HIL TEST");
  oled.setFont(u8g2_font_6x12_tr);
  oled.drawStr(0, 60, "OLED OK");
  oled.sendBuffer();
  Serial.println("drawn");
}

void loop() {
  delay(2000);
  Serial.println("alive");
}
