"""Runs src/py/leds_lego.py, the script that drives the 16 Lego LEDs for the AR test, on a virtual robot with a
clock that only moves when the script sleeps (or when an LED call 'takes time'). The script is the real one, with
its mode written in the way the page does it (src/script.js).

    python3 -I tests/test_leds_lego.py
"""
import os
import re
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = open(os.path.join(HERE, "..", "src", "py", "leds_lego.py"), encoding="utf8").read()
HALF_MS = int(re.search(r"^HALF_MS = (\d+)", SOURCE, re.M).group(1))


class Stop(Exception):
    pass


class Robot:
    def __init__(self, mode, limit_ms, led_cost_ms=0.0, group=-1, half_ms=None):
        self.mode = mode
        self.group = group
        self.half_ms = half_ms
        self.limit = limit_ms
        self.cost = led_cost_ms             # time one LED call takes, on the robot's clock
        self.now = 0.0
        self.events = []                    # ("behaviors off",) or ("led", row, i, level, time)
        self.sleeps = []
        self.state = {"front": [None] * 8, "back": [None] * 8}

    def modules(self):
        robot = self
        th = types.ModuleType("thymio")

        class Behaviors:
            def disable_behaviors(self):
                robot.events.append(("behaviors off",))

        class Led:
            def __init__(self, row, i):
                self.row, self.i = row, i

            def intensity(self, level):
                robot.events.append(("led", self.row, self.i, level, robot.now))
                robot.state[self.row][self.i] = level
                robot.now += robot.cost

        th.BEHAVIORS = Behaviors
        th.LEDS_LEGO_FRONT = lambda i: Led("front", i)
        th.LEDS_LEGO_BACK = lambda i: Led("back", i)

        tm = types.ModuleType("time")
        tm.ticks_ms = lambda: int(robot.now)
        tm.ticks_diff = lambda a, b: a - b

        def sleep_ms(ms):
            if ms <= 0:
                raise AssertionError("sleep_ms(%r): the script must never sleep a negative or empty time" % ms)
            robot.sleeps.append(ms)
            robot.now += ms
            if robot.now >= robot.limit:
                raise Stop()

        tm.sleep_ms = sleep_ms
        return th, tm

    def run(self):
        text = SOURCE.replace('MODE = "on"', 'MODE = "%s"' % self.mode).replace("GROUP = -1", "GROUP = %d" % self.group)
        if self.half_ms:
            text = re.sub(r"^HALF_MS = \d+", "HALF_MS = %d" % self.half_ms, text, flags=re.M)
        saved = {k: sys.modules.get(k) for k in ("thymio", "time")}
        sys.modules["thymio"], sys.modules["time"] = self.modules()
        try:
            exec(compile(text, "leds_lego.py", "exec"), {"__name__": "__main__"})
        except Stop:
            pass
        finally:
            for k, v in saved.items():
                if v is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = v
        return self

    def shows(self):
        """The moments the script wrote the 16 LEDs, with the level it wrote: [(time, level)]."""
        leds = [e for e in self.events if e[0] == "led"]
        return [(leds[i][4], leds[i][3]) for i in range(0, len(leds), 16)]


class Source(unittest.TestCase):
    def test_one_mode_line_one_group_line_and_a_half_period(self):
        self.assertEqual(SOURCE.count('MODE = "on"'), 1)
        self.assertEqual(SOURCE.count("GROUP = -1"), 1)
        self.assertGreater(HALF_MS, 20)                     # the LEDs' own PWM runs at 50 Hz (20 ms)


class SteadyModes(unittest.TestCase):
    def test_behaviors_are_switched_off_before_any_led(self):
        r = Robot("on", 1200).run()
        self.assertEqual(r.events[0], ("behaviors off",))

    def test_on_sets_all_sixteen_to_full_and_again_each_turn(self):
        r = Robot("on", 1600).run()
        for row in ("front", "back"):
            self.assertEqual(r.state[row], [16] * 8)
        self.assertEqual({e[3] for e in r.events if e[0] == "led"}, {16})
        self.assertEqual(len(r.shows()), 4)
        self.assertEqual(r.sleeps, [500] * 4)

    def test_off_sets_all_sixteen_to_zero(self):
        r = Robot("off", 1200).run()
        for row in ("front", "back"):
            self.assertEqual(r.state[row], [0] * 8)
        self.assertEqual({e[3] for e in r.events if e[0] == "led"}, {0})


class Blink(unittest.TestCase):
    def test_alternates_full_and_dark_every_half_period(self):
        r = Robot("blink", 40 * HALF_MS).run()
        shows = r.shows()
        self.assertGreaterEqual(len(shows), 38)
        self.assertEqual([lvl for _, lvl in shows[:6]], [16, 0, 16, 0, 16, 0])
        for (t0, _), (t1, _) in zip(shows, shows[1:]):
            self.assertEqual(t1 - t0, HALF_MS)

    def test_never_a_level_between_dark_and_full(self):
        r = Robot("blink", 30 * HALF_MS).run()
        self.assertEqual({e[3] for e in r.events if e[0] == "led"}, {0, 16})

    def test_all_sixteen_change_together_in_each_show(self):
        r = Robot("blink", 10 * HALF_MS).run()
        leds = [e for e in r.events if e[0] == "led"]
        for i in range(0, len(leds) - 15, 16):
            self.assertEqual(len({e[3] for e in leds[i:i + 16]}), 1)

    def test_the_beat_does_not_drift_when_the_led_calls_take_time(self):
        # 16 calls of 0.25 ms = 4 ms a show: the beat is kept against the clock, not by adding sleeps
        r = Robot("blink", 300 * HALF_MS, led_cost_ms=0.25).run()
        shows = r.shows()
        self.assertGreater(len(shows), 290)
        for n, (t, _) in enumerate(shows):
            self.assertLessEqual(abs(t - n * HALF_MS), 1.0, "show %d at %.2f instead of %d" % (n, t, n * HALF_MS))

    def test_a_robot_that_falls_behind_does_not_crash_and_does_not_rush(self):
        # 16 calls that take together 1.2 x HALF_MS a show: nothing to sleep, the count starts again from now
        r = Robot("blink", 30 * HALF_MS, led_cost_ms=1.2 * HALF_MS / 16).run()
        shows = r.shows()
        self.assertGreater(len(shows), 10)
        self.assertEqual([lvl for _, lvl in shows[:4]], [16, 0, 16, 0])


class Groups(unittest.TestCase):
    """GROUP: all 16 LEDs (-1) or four aligned on one row, 16 mm apart; the others stay dark."""

    def lit(self, r):
        return {(row, i) for row in ("front", "back") for i, lvl in enumerate(r.state[row]) if lvl == 16}

    def test_a_steady_group_lights_four_aligned_leds_of_one_row_and_leaves_the_rest_dark(self):
        for g in range(4):
            r = Robot("on", 1200, group=g).run()
            lit = self.lit(r)
            self.assertEqual(len(lit), 4, "group %d" % g)
            self.assertEqual({row for row, _ in lit}, {"front" if g < 2 else "back"})
            self.assertEqual(sorted(i for _, i in lit), [g % 2 + 2 * k for k in range(4)])     # every other LED: 16 mm apart
            self.assertEqual(sum(1 for row in r.state.values() for lvl in row if lvl == 0), 12)
            self.assertEqual({lvl for row in r.state.values() for lvl in row}, {0, 16})

    def test_the_four_groups_are_the_sixteen_leds_each_once(self):
        seen = []
        for g in range(4):
            seen += sorted(self.lit(Robot("on", 1200, group=g).run()))
        self.assertEqual(len(seen), 16)
        self.assertEqual(len(set(seen)), 16)

    def test_a_blinking_group_switches_only_its_four_leds_and_keeps_the_beat(self):
        half = 100
        r = Robot("blink", 30 * half, group=2, half_ms=half).run()
        leds = [e for e in r.events if e[0] == "led"]
        touched_on = {(e[1], e[2]) for e in leds if e[3] == 16}
        self.assertEqual(touched_on, {("back", 0), ("back", 2), ("back", 4), ("back", 6)})
        shows = r.shows()
        for (t0, _), (t1, _) in zip(shows, shows[1:]):
            self.assertEqual(t1 - t0, half)

    def test_the_half_period_the_page_writes_is_the_one_used(self):
        r = Robot("blink", 40 * 400, half_ms=400).run()
        shows = r.shows()
        self.assertGreaterEqual(len(shows), 38)
        for (t0, _), (t1, _) in zip(shows, shows[1:]):
            self.assertEqual(t1 - t0, 400)


if __name__ == "__main__":
    unittest.main()
