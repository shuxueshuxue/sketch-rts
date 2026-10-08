"""Connected, static sail rigs in ship coordinates (+X points to the bow).

These are simplified display poses under a common quartering pressure direction,
not an aerodynamic solver. Every sheet starts at the cloth corner it controls;
yards have a halyard and a parrel, and cloth heads are laced to their yards.
"""

import math

from ship_sails import build_quad_sail, build_triangle_sail


def _lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def build_running_rig(kind, mast, length, beam, height, cloth, rope, wood,
                      mesh, spar, layer, *, stay_to=None):
    x, y, z = mast
    pressure = (1, .65, 0)

    def line(name, start, end, radius=.28, material=None):
        return spar(name, start, end, radius, material or rope, layer)

    def belay(name, start, at, base_z=None, pin=False):
        line(name, start, at)
        line(name + " belaying post", (at[0], at[1], z + 1 if base_z is None else base_z), at, .4 if pin else .7, wood)
        if pin:
            line(name + " cleat", (at[0], at[1] - .65, at[2]),
                 (at[0], at[1] + .65, at[2]), .25, wood)
        else:
            line(name + " cleat", (at[0] - 1.2, at[1], at[2]),
                 (at[0] + 1.2, at[1], at[2]), .55, wood)

    def yard(name, a, b, mast_top, radius=1.2, fall_offset=(0, 4)):
        line(name, a, b, radius, wood)
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
        sling = _lerp(a, b, t)
        offset = math.hypot(sling[0] - x, sling[1] - y)
        nx, ny = (sling[0] - x) / offset, (sling[1] - y) / offset
        square = kind in ("warship", "carrier")
        top = (x + fall_offset[0], y + fall_offset[1], mast_top) if square else (x + nx * 3.2, y + ny * 3.2, mast_top)
        line(name + " halyard", sling, top, .34)
        line(name + " halyard block", (top[0], top[1], top[2] - .7),
             (top[0], top[1], top[2] + .7), .65, wood)
        if square:
            cabin_height = ({"warship": 22, "carrier": 30}[kind] if x < 0 else 0)
            belay(name + " halyard fall", top, (top[0], top[1], z + cabin_height + 7),
                  base_z=z + cabin_height + (2.8 if cabin_height else 1), pin=True)
        else:
            belay(name + " halyard fall", top, (x + 9, y + ny * 4, z + 6))
        # A low-poly parrel actually encircles the mast and returns to the yard.
        ring = [(x + 2.7, y + 2.7, sling[2]), (x - 2.7, y + 2.7, sling[2]),
                (x - 2.7, y - 2.7, sling[2]), (x + 2.7, y - 2.7, sling[2])]
        # Connect to the nearest side of the loop without cutting across it.
        reach = 2.7 / max(abs(nx), abs(ny))
        anchor = (x + nx * reach, y + ny * reach, sling[2])
        line(name + " parrel strop", sling, anchor, .32)
        ring.append(ring[0])
        for start, end in zip(ring, ring[1:]):
            line(name + " parrel", start, end, .32)

    def laced_head(name, a, b, radius=1.2):
        # Project down onto the plane normal to the yard. A vertical-only
        # offset would leave a steep lateen head buried inside its spar.
        delta = tuple(end - start for start, end in zip(a, b))
        size = math.hypot(*delta)
        direction = tuple(component / size for component in delta)
        down = (direction[0] * direction[2], direction[1] * direction[2],
                direction[2] * direction[2] - 1)
        drop = tuple(component * (radius + .5) / math.hypot(*down) for component in down)
        head = [list(_lerp(a, b, t)) for t in (.025, .975)]
        head = [tuple(position + offset for position, offset in zip(point, drop)) for point in head]
        for index in range(9):
            t = index / 8
            line(name + " head lacing", _lerp(head[0], head[1], t),
                 _lerp(a, b, .025 + t * .95), .16)
        return tuple(head[0]), tuple(head[1])

    def triangle(name, corners, depth):
        build_triangle_sail(name, corners, depth, cloth, rope, mesh, spar, layer,
                            billow_direction=pressure)

    def quad(name, corners, depth, panels=8, rows=6):
        build_quad_sail(name, corners, depth, cloth, rope, mesh, spar, layer,
                        panels=panels, rows=rows, billow_direction=pressure)

    if kind in ("cutter", "fireShip", "bombardShip"):
        # The fixed aft mast leaves little room abaft it: use a narrow lateen,
        # with the high yard end aft, tack forward, and a separate aft clew.
        fore = (x + length * .22, y + 4, z + height * .36)
        peak = (max(-length * .46, x - length * .17), y + 4, z + height * .98)
        yard("lateen yard", fore, peak, z + height)
        tack, head = laced_head("lateen sail", fore, peak)
        cabin_height = {"cutter": 9, "fireShip": 12, "bombardShip": 15}[kind]
        clew = (max(-length * .43, x - length * .12), y + beam * .24,
                z + max(cabin_height + 8, height * .32))
        triangle("lateen sail", (tack, head, clew), beam * .075)
        belay("lateen tack downhaul", tack, (fore[0] + 3, y + 4, z + 9))
        belay("lateen clew sheet", clew, (-length * .47, beam * .27, z + 10))
    elif kind == "transport":
        # A standing lug: the upper yard projects a little ahead of the mast,
        # while the tack is held by the mast and the clew leads aft.
        fore = (x + length * .05, y + 4, z + height * .72)
        peak = (max(-length * .46, x - length * .17), y + 4, z + height * .98)
        yard("standing lug yard", fore, peak, z + height)
        head_fore, head_aft = laced_head("standing lug sail", fore, peak)
        tack = (x + 2, y + 4, z + 25)
        clew = (max(-length * .43, x - length * .12), y + beam * .24, z + 27)
        quad("standing lug sail", (tack, clew, head_aft, head_fore), beam * .07)
        belay("standing lug tack downhaul", tack, (x + 12, y + 4, z + 7))
        belay("standing lug clew sheet", clew, (-length * .47, beam * .27, z + 10))
    else:
        # Square yards sit forward of the mast; the parrel spans the clearance.
        yard_x = x + 3.8
        lower = [(yard_x, y + side * beam * .55, z + height * .68) for side in (-1, 1)]
        upper = [(yard_x, y + side * beam * .365, z + height * .97) for side in (-1, 1)]
        yard("lower yard", *lower, z + height * .89, fall_offset=(-.5, 4.4))
        yard("topsail yard", *upper, z + height, radius=.9, fall_offset=(.6, 4.4))
        lower_head = laced_head("course sail", *lower)
        upper_head = laced_head("topsail", *upper, radius=.9)
        cabin_height = {"warship": 22, "carrier": 30}[kind]
        foot_height = max(height * .23, cabin_height + 9)
        course_clews = [(yard_x, y + side * beam * .46, z + foot_height) for side in (-1, 1)]
        topsail_foot = .79 if kind == "carrier" else .74
        topsail_clews = [(yard_x, y + side * beam * .32, z + height * topsail_foot) for side in (-1, 1)]
        quad("course sail", (*course_clews, lower_head[1], lower_head[0]), beam * .16)
        quad("square topsail", (*topsail_clews, upper_head[1], upper_head[0]), beam * .075, panels=6, rows=4)
        for index, side in enumerate((-1, 1)):
            aft_x = max(-length * .43, x - length * .15)
            belay("course clew sheet", course_clews[index], (aft_x, y + side * beam * .36, z + 10))
            line("topsail clew sheet", topsail_clews[index], lower[index], .3)
            for name, ends, lift_height in (("lower yard", lower, .88), ("topsail yard", upper, 1)):
                line(name + " lift", ends[index], (x, y, z + height * lift_height), .25)
                belay(name + " brace", ends[index], (aft_x, y + side * beam * .30, z + 10))

    if kind in ("cutter", "warship", "carrier"):
        stay_top = (x, y, z + height * (.96 if kind == "cutter" else 1))
        # The aft mast is stayed to the forward masthead, above its sails.
        stay_foot = (length * .61, 0, z + 21)
        if stay_to is not None:
            stay_foot = stay_to
        line("forestay", stay_top, stay_foot, .5)
        if kind == "cutter":
            # Head and tack lie on the actual stay; the sheet leads the clew
            # out to the same leeward side as the mainsail's display pose.
            head, tack = _lerp(stay_top, stay_foot, .13), _lerp(stay_top, stay_foot, .94)
            clew = (x + 22, y + beam * .28, z + max(20, height * .25))
            triangle("light jib", (head, tack, clew), beam * .055)
            line("jib halyard", head, stay_top, .24)
            line("jib tack strop", tack, stay_foot, .3)
            belay("jib clew sheet", clew, (x + 5, y + beam * .40, z + 10))
