# Thymio 3 - AR test: the LEDs on the top of the robot, all on, all off, or blinking, until the script is stopped.
#
# The page writes the mode in the line MODE below ("on", "off" or "blink"), and which LEDs in GROUP and CIRCLE.
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
# GROUP: which of the 16 green Lego LEDs the mode drives. -2: none. -1: all 16. 0..3: only 4 of them, ALIGNED on one
# row and 16 mm apart (every other LED of the row: indices 0, 2, 4, 6 or 1, 3, 5, 7), because at 8 mm (neighbours)
# a phone camera cannot tell the LEDs from each other: their glows run together. 0: front row, even indices; 1:
# front row, odd; 2: back row, even; 3: back row, odd. Four LEDs on a straight line at even spacing is also what
# the page uses as a filter: a false spot is unlikely to fall on that line.
#
# CIRCLE: which of the 8 amber LEDs of the ring round the touch pad the mode drives (the firmware names them N, NE, E,
# SE, S, SW, W, NW for the indices 0..7; each is an arc of about 45 degrees). -1: none. 0: the even indices (N, E, S, W),
# four points at 90 degrees: a square turned by 45 degrees. 1: the odd indices (NE, SE, SW, NW): a square whose sides
# are parallel to the axes of the robot, so two of them are parallel to the rows of Lego LEDs (if N points to the nose:
# to be checked on the robot).
#
# "blink": the chosen LEDs on for HALF_MS, off for HALF_MS, and so on. When both a Lego group and a ring set are
# chosen they ALTERNATE: the Lego LEDs are on while the ring is off, and the other way round (each set still blinks at
# the same rhythm). The page looks for pixels that do this (pairdiff.js); HALF_MS must be the same there (src/script.js:
# tests/script.test.js checks it). The beat is kept against the clock of the robot, not by adding sleeps, so that it
# does not drift.
import thymio
import time

MODE = "on"
GROUP = -1
CIRCLE = -1
HALF_MS = 200           # 2.5 Hz: a camera at 30 pictures a second sees about 6 on, 6 off (the page writes its choice here)

beh = thymio.BEHAVIORS()
beh.disable_behaviors()
front = [thymio.LEDS_LEGO_FRONT(i) for i in range(8)]
back = [thymio.LEDS_LEGO_BACK(i) for i in range(8)]
ring = [thymio.LEDS_CIRCLE(i) for i in range(8)]

# Every OTHER light of the robot goes out. Behaviors off does not light them or put them out: they stay as the last script or behavior left them.
# In the photo of the 12th test the four RGB LEDs at the corners glowed magenta and cyan (the pattern of the card mode) and the one under the robot,
# that shows the colour of the floor, was lit: steady or changing lights, near the row and the ring, in the colours the page looks for.
# RGB 0..3 the corners, 4 the one under the robot (the colour of the floor), 5 the small one at the back; the 4 LEDs of the buttons; the white
# LED of the colour sensor; the receiver and the microphone LEDs. (The infrared emitters of the proximity and ground sensors cannot be switched off.)
for i in range(6):
    thymio.LEDS_RGB(i).off()
for i in range(4):
    thymio.LEDS_BUTTONS(i).off()
thymio.LED_COLOR().off()
thymio.LED_RECEIVER().off()
thymio.LED_MICROPHONE().off()


def show(lego, circle):
    # lego, circle: the level (0 or 16) of the Lego LEDs of the group and of the ring LEDs of the set
    for i in range(8):
        front[i].intensity(lego if GROUP == -1 or (0 <= GROUP < 2 and i % 2 == GROUP) else 0)
        back[i].intensity(lego if GROUP == -1 or (GROUP >= 2 and i % 2 == GROUP - 2) else 0)
    for i in range(8):
        ring[i].intensity(circle if CIRCLE >= 0 and i % 2 == CIRCLE else 0)


if MODE == "blink":
    alternate = GROUP != -2 and CIRCLE >= 0
    t0 = time.ticks_ms()
    n = 0
    on = True
    while True:
        a = 16 if on else 0
        show(a, (16 - a) if alternate else a)
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
        show(level, level)
        time.sleep_ms(500)
