"""Connected sail rigs in ship coordinates (+X points to the bow).

The authored full-sail pose also supplies flat cloth, signed billow and furl
targets. Moving spars share a mast frame; running ropes name their real cloth
or spar anchors. The exporter converts this visual metadata to glTF space.
This is a simplified rig animation, not a cloth or aerodynamic solver.
"""

import json
import math

from ship_sails import build_quad_sail, build_triangle_sail


def _lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def build_running_rig(kind, mast, length, beam, height, cloth, rope, wood,
                      mesh, spar, layer, *, stay_to=None, dynamic=False, rig_id="mast0"):
    x, y, z = mast
    square = kind in ("warship", "carrier")
    pressure = (1, 0, 0) if square else (0, 1, 0)
    limit = math.radians(50 if square else 65)
    manifest = {"frames": [{"id": rig_id, "pivot": mast, "axis": (0, 0, 1),
                            "angleScale": 1, "angleOffset": 0, "angleLimits": (-limit, limit)}],
                "sails": [], "rigidParts": [{"node": "Rig_" + rig_id, "frameId": rig_id}]}

    def point(at, frame=None):
        return {"point": tuple(at), **({"frameId": frame} if frame else {})}

    def surface(sail_id, u, v):
        return {"sailId": sail_id, "uv": (u, v)}

    def line(name, start, end, radius=.28, material=None, *, frame=None, a=None, b=None):
        obj = spar(name, start, end, radius, material or rope, layer)
        if dynamic:
            if a is not None or b is not None:
                obj["rigLine"] = json.dumps({"id": obj.name, "a": a or point(start),
                                              "b": b or point(end), "radius": radius})
            elif frame:
                obj["rigPart"] = "Rig_" + frame
        return obj

    def belay(name, start, at, base_z=None, pin=False, *, anchor=None):
        line(name, start, at, a=anchor)
        line(name + " belaying post", (at[0], at[1], z + 1 if base_z is None else base_z), at, .4 if pin else .7, wood)
        if pin:
            line(name + " cleat", (at[0], at[1] - .65, at[2]),
                 (at[0], at[1] + .65, at[2]), .25, wood)
        else:
            line(name + " cleat", (at[0] - 1.2, at[1], at[2]),
                 (at[0] + 1.2, at[1], at[2]), .55, wood)

    def guided_sheet(name, start, anchor, cabin_height):
        # Gathering a fore-and-aft sail moves its clew towards the yard.
        # A direct lead to the stern can then cut through the mast. This
        # supported guide rotates with the rig, above the cabin roof; its
        # short fall stays outside the mast throughout the 65-degree sweep.
        guide = (x, y + 8, z + cabin_height + 6)
        line(name, start, guide, a=anchor, b=point(guide, rig_id))
        line(name + " guide arm", (x, y, guide[2]), guide, .55, wood, frame=rig_id)
        line(name + " guide block", (guide[0], guide[1], guide[2] - .65),
             (guide[0], guide[1], guide[2] + .65), .6, wood, frame=rig_id)
        belay(name + " fall", guide, (x, y + 9, guide[2]),
              base_z=z + cabin_height + 2.8, anchor=point(guide, rig_id))

    def yard(name, a, b, mast_top, radius=1.2, fall_offset=(0, 4)):
        line(name, a, b, radius, wood, frame=rig_id)
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
        sling = _lerp(a, b, t)
        offset = math.hypot(sling[0] - x, sling[1] - y)
        nx, ny = (sling[0] - x) / offset, (sling[1] - y) / offset
        square = kind in ("warship", "carrier")
        top = (x + fall_offset[0], y + fall_offset[1], mast_top) if square else (x, y + 6, mast_top)
        line(name + " halyard", sling, top, .34, frame=rig_id)
        line(name + " halyard block", (top[0], top[1], top[2] - .7),
             (top[0], top[1], top[2] + .7), .65, wood, frame=rig_id)
        line(name + " block arm", (x, y, mast_top), top, .45, wood, frame=rig_id)
        if square:
            cabin_height = ({"warship": 22, "carrier": 30}[kind] if x < 0 else 0)
            guide = (x + (-.35 if name == "lower yard" else .35), y + 2.7,
                     z + height * (.76 if kind == "carrier" else .63))
            line(name + " moving halyard fall", top, guide, a=point(top, rig_id))
            belay(name + " halyard fall", guide, (guide[0], guide[1], z + cabin_height + 7),
                  base_z=z + cabin_height + (2.8 if cabin_height else 1), pin=True)
        else:
            cabin_height = {"cutter": 9, "fireShip": 12, "bombardShip": 15, "transport": 17}[kind]
            guide = (x, y + 2.6, z + height * .93)
            line(name + " moving halyard fall", top, guide, a=point(top, rig_id))
            belay(name + " halyard fall", guide, (x, y + 2.6, z + cabin_height + 7),
                  base_z=z + cabin_height + 2.8, pin=True)
        line(name + " fixed guide bracket", (x, y, guide[2]), guide, .35, wood)
        line(name + " guide block", (guide[0], guide[1], guide[2] - .4),
             (guide[0], guide[1], guide[2] + .4), .4, wood)
        # A low-poly parrel actually encircles the mast and returns to the yard.
        ring = [(x + 2.7, y + 2.7, sling[2]), (x - 2.7, y + 2.7, sling[2]),
                (x - 2.7, y - 2.7, sling[2]), (x + 2.7, y - 2.7, sling[2])]
        # Connect to the nearest side of the loop without cutting across it.
        reach = 2.7 / max(abs(nx), abs(ny))
        anchor = (x + nx * reach, y + ny * reach, sling[2])
        line(name + " parrel strop", sling, anchor, .32, frame=rig_id)
        ring.append(ring[0])
        for start, end in zip(ring, ring[1:]):
            line(name + " parrel", start, end, .32, frame=rig_id)

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
                 _lerp(a, b, .025 + t * .95), .16, frame=rig_id)
        return tuple(head[0]), tuple(head[1])

    def triangle(name, corners, depth, *, frame=rig_id, reverse=1):
        sail_id = frame + ("_jib" if name == "light jib" else "_main")
        node = "Sail_" + sail_id
        obj = build_triangle_sail(node, corners, depth, cloth, rope, mesh, spar, layer,
                                  billow_direction=(0, 1, 0), dynamic=dynamic,
                                  sail_id=sail_id, negative_depth=reverse)
        if dynamic:
            obj["rigPart"] = node
        manifest["sails"].append({"id": sail_id, "node": node, "frameId": frame})
        return sail_id

    def quad(name, corners, depth, panels=8, rows=6):
        sail_id = rig_id + ("_topsail" if name == "square topsail" else "_main")
        node = "Sail_" + sail_id
        obj = build_quad_sail(node, corners, depth, cloth, rope, mesh, spar, layer,
                             panels=panels, rows=rows, billow_direction=pressure,
                             dynamic=dynamic, sail_id=sail_id, negative_depth=1)
        if dynamic:
            obj["rigPart"] = node
        manifest["sails"].append({"id": sail_id, "node": node, "frameId": rig_id})
        return sail_id

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
        main_id = triangle("lateen sail", (tack, head, clew), beam * .075)
        belay("lateen tack downhaul", tack, (fore[0] + 3, y + 4, z + 9), anchor=surface(main_id, 0, 0))
        guided_sheet("lateen clew sheet", clew, surface(main_id, .5, 1), cabin_height)
    elif kind == "transport":
        # A standing lug: the upper yard projects a little ahead of the mast,
        # while the tack is held by the mast and the clew leads aft.
        fore = (x + length * .05, y + 4, z + height * .72)
        peak = (max(-length * .46, x - length * .17), y + 4, z + height * .98)
        yard("standing lug yard", fore, peak, z + height)
        head_fore, head_aft = laced_head("standing lug sail", fore, peak)
        tack = (x + 2, y + 4, z + 25)
        clew = (max(-length * .43, x - length * .12), y + beam * .24, z + 27)
        main_id = quad("standing lug sail", (tack, clew, head_aft, head_fore), beam * .07)
        belay("standing lug tack downhaul", tack, (x + 4, y + 8, z + 23),
              base_z=z + 19.8, anchor=surface(main_id, 0, 0))
        guided_sheet("standing lug clew sheet", clew, surface(main_id, 1, 0), 17)
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
        main_id = quad("course sail", (*course_clews, lower_head[1], lower_head[0]), beam * .16)
        top_id = quad("square topsail", (*topsail_clews, upper_head[1], upper_head[0]), beam * .075, panels=6, rows=4)
        for index, side in enumerate((-1, 1)):
            aft_x = max(-length * .43, x - length * .15)
            belay("course clew sheet", course_clews[index], (aft_x, y + side * beam * .36, z + 10), anchor=surface(main_id, index, 0))
            line("topsail clew sheet", topsail_clews[index], lower[index], .3,
                 a=surface(top_id, index, 0), b=point(lower[index], rig_id))
            for name, ends, lift_height in (("lower yard", lower, .88), ("topsail yard", upper, 1)):
                line(name + " lift", ends[index], (x, y, z + height * lift_height), .25, frame=rig_id)
                belay(name + " brace", ends[index], (aft_x, y + side * beam * .30, z + 10), anchor=point(ends[index], rig_id))

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
            clew = (x + 28, y, z + max(20, height * .25))
            axis = tuple(b - a for a, b in zip(head, tack))
            size = math.hypot(*axis)
            jib_frame = rig_id + "_jib"
            manifest["frames"].append({"id": jib_frame, "pivot": head,
                                        "axis": tuple(v / size for v in axis), "angleScale": .25,
                                        "angleOffset": 0, "angleLimits": (-limit * .25, limit * .25)})
            jib_id = triangle("light jib", (head, tack, clew), beam * .055, frame=jib_frame, reverse=beam*.055)
            line("jib halyard", head, stay_top, .24)
            line("jib tack strop", tack, stay_foot, .3)
            belay("jib clew sheet", clew, (x + 5, y + beam * .40, z + 10), anchor=surface(jib_id, .5, 1))
    return manifest
