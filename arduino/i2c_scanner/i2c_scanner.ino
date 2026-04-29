// Temporary diagnostic sketch — uploads to the same Arduino Uno + Grove
// Beginner Kit and reports every I2C device address that ACKs.
//
// Open Serial Monitor at 115200 baud after upload. Once you see a result,
// switch back to the hil_grove sketch.

#include <Wire.h>

void setup() {
  Serial.begin(115200);
  Wire.begin();
  delay(500);
  Serial.println();
  Serial.println("I2C Scanner — searching 0x01..0x7E");
}

void loop() {
  byte found = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte error = Wire.endTransmission();
    if (error == 0) {
      Serial.print("  device at 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      found++;
    }
  }
  if (found == 0) {
    Serial.println("  no I2C devices found — OLED isn't on the bus");
  } else {
    Serial.print("  total found: ");
    Serial.println(found);
  }
  Serial.println("---");
  delay(3000);
}
