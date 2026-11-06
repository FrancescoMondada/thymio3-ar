# Thymio 3 - AR test: the 16 Lego LEDs on the top, all on, all off, or blinking, until the script is stopped.
#
# The page writes the mode in the line MODE below ("on", "off" or "blink").
#
# It runs on the robot: the firmware has behaviors of its own that draw on these LEDs (the gyroscope, in the
# default mode; the number of lessons or of cards in the learning and card modes), and a Bluetooth command from
# the page would be overwritten by them. A script that has switched the behaviors off owns the LEDs. When it
# ends (the page stops it, or closes), the firmware puts the lights out and gets its behaviors back.
#
# The Bluetooth command takes 0..15 for an LED; a script takes 0..16 (MAX_BRIGHTNESS). The LEDs are dimmed by
# a software PWM at 50 Hz in 16 steps: 15 is dark for 1/16 of every 20 ms, 16 never is. A camera with a short
# exposure can catch the dark moment, so this script uses 16, or 0: never anything in between.
#
# "blink": all 16 LEDs on for HALF_MS, off for HALF_MS, and so on. The page looks for a pixel that does this
# (lockin.js); HALF_MS must be the same there (src/script.js: tests/script.test.js checks it). The beat is kept
# against the clock of the robot, not by adding sleeps, so that it does not drift.
import thymio
import time

MODE = "on"
HALF_MS = 67            # 7.46 Hz: a camera at 30 pictures a second sees about 2 on, 2 off

beh = thymio.BEHAVIORS()
beh.disable_behaviors()
front = [thymio.LEDS_LEGO_FRONT(i) for i in range(8)]
back = [thymio.LEDS_LEGO_BACK(i) for i in range(8)]


def show(level):
    for i in range(8):
        front[i].intensity(level)
        back[i].intensity(level)


if MODE == "blink":
    t0 = time.ticks_ms()
    n = 0
    on = True
    while True:
        show(16 if on else 0)
        on = not on
        n += 1
        wait = n * HALF_MS - time.ticks_diff(time.ticks_ms(), t0)
        if wait > 0:
            time.sleep_ms(wait)
        else:
            # behind (the robot was busy): do not rush to catch up, start the count again from now
            # (after a short sleep, so that the other tasks of the robot always get their turn)
            time.sleep_ms(1)
            t0 = time.ticks_ms()
            n = 0
else:
    level = 16 if MODE == "on" else 0
    while True:
        show(level)
        time.sleep_ms(500)
