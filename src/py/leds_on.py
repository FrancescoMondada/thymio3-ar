# Thymio 3 - AR test: the 16 Lego LEDs on the top, all at full brightness, until the script is stopped.
#
# It runs on the robot: the firmware has behaviors of its own that draw on these LEDs (the gyroscope, in
# the default mode; the number of lessons or of cards in the learning and card modes), and a Bluetooth
# command from the page would be overwritten by them. A script that has switched the behaviors off owns
# the LEDs. When it ends (the page stops it, or closes), the firmware puts the lights out and gets its
# behaviors back.
#
# The Bluetooth command takes 0..15 for an LED; a script takes 0..16 (MAX_BRIGHTNESS). The LEDs are
# dimmed by a software PWM at 50 Hz in 16 steps: 15 is dark for 1/16 of every 20 ms, 16 never is. A
# camera with a short exposure can catch the dark moment, so this script uses 16.
import thymio
import time

LEVEL = 16

beh = thymio.BEHAVIORS()
beh.disable_behaviors()
front = [thymio.LEDS_LEGO_FRONT(i) for i in range(8)]
back = [thymio.LEDS_LEGO_BACK(i) for i in range(8)]

while True:
    for i in range(8):
        front[i].intensity(LEVEL)
        back[i].intensity(LEVEL)
    time.sleep_ms(500)
