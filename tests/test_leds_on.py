"""Runs src/py/leds_on.py, the script that lights the 16 Lego LEDs for the AR test, on a virtual robot: the
behaviors are switched off first, then every LED goes to 16 (never more) and stays there while the script loops.

    python3 -I tests/test_leds_on.py
"""
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = open(os.path.join(HERE, "..", "src", "py", "leds_on.py"), encoding="utf8").read()


class Stop(Exception):
    pass


class Robot:
    def __init__(self, loops=3):
        self.events = []                       # in order: ("behaviors off",), ("led", name, index, value)
        self.loops = loops
        self.sleeps = []
        self.lego = {"front": [None] * 8, "back": [None] * 8}

    def module(self):
        robot = self
        m = types.ModuleType("thymio")

        class Behaviors:
            def disable_behaviors(self):
                robot.events.append(("behaviors off",))

        class Led:
            def __init__(self, row, i):
                self.row, self.i = row, i

            def intensity(self, value):
                robot.events.append(("led", self.row, self.i, value))
                robot.lego[self.row][self.i] = value

        m.BEHAVIORS = Behaviors
        m.LEDS_LEGO_FRONT = lambda i: Led("front", i)
        m.LEDS_LEGO_BACK = lambda i: Led("back", i)
        return m

    def clock(self):
        t = types.ModuleType("time")

        def sleep_ms(ms):
            self.sleeps.append(ms)
            if len(self.sleeps) >= self.loops:
                raise Stop()

        t.sleep_ms = sleep_ms
        return t

    def run(self):
        saved = {k: sys.modules.get(k) for k in ("thymio", "time")}
        sys.modules["thymio"] = self.module()
        sys.modules["time"] = self.clock()
        try:
            exec(compile(SOURCE, "leds_on.py", "exec"), {"__name__": "__main__"})
        except Stop:
            pass
        finally:
            for k, v in saved.items():
                if v is None:
                    sys.modules.pop(k, None)
                else:
                    sys.modules[k] = v


class LedsOn(unittest.TestCase):
    def setUp(self):
        self.robot = Robot()
        self.robot.run()

    def test_behaviors_are_switched_off_before_any_led(self):
        self.assertEqual(self.robot.events[0], ("behaviors off",))

    def test_all_sixteen_leds_are_at_full_brightness(self):
        for row in ("front", "back"):
            self.assertEqual(self.robot.lego[row], [16] * 8)

    def test_no_led_is_ever_set_above_the_maximum_or_below_full(self):
        values = [e[3] for e in self.robot.events if e[0] == "led"]
        self.assertTrue(values)
        self.assertEqual(set(values), {16})

    def test_the_leds_are_set_again_each_turn_of_the_loop(self):
        self.assertEqual(len([e for e in self.robot.events if e[0] == "led"]), 16 * 3)
        self.assertEqual(self.robot.sleeps, [500, 500, 500])


if __name__ == "__main__":
    unittest.main()
