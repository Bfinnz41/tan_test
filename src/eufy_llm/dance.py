"""Dance routines.

The X10 Pro Omni has no native dance mode, so we fake it with whatever
movement primitives the device exposes. If manual joystick control works,
we use it for an actual spin; otherwise we fall back to a goofy sequence
of play/pause that makes the robot lurch in place.
"""

from __future__ import annotations

import asyncio

from .robot import Robot


async def dance(robot: Robot) -> str:
    try:
        await robot.manual_move("left", 0.5)
        await robot.manual_move("right", 0.5)
        await robot.manual_move("forward", 0.4)
        await robot.manual_move("back", 0.4)
        await robot.manual_move("left", 0.8)
        await robot.manual_move("right", 0.8)
        return "Danced via manual control (spin + shimmy)."
    except AttributeError:
        await robot.start_cleaning()
        await asyncio.sleep(1.5)
        await robot.pause()
        await asyncio.sleep(0.8)
        await robot.start_cleaning()
        await asyncio.sleep(1.5)
        await robot.pause()
        await asyncio.sleep(0.8)
        await robot.return_to_dock()
        return "Danced via the play/pause shuffle (manual control not available on this model)."
