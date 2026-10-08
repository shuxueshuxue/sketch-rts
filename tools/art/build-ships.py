#!/usr/bin/env python3
"""Build editable Blender ships and their physical geometry for the GLB exporter."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/naval/ships.json"
BUILD = ROOT / ".art-build/ships"


def outline(length, beam, margin=0):
    a, b = length / 2 - margin, beam / 2 - margin
    return [[-a, -b * .56], [-a * .88, -b * .82], [-a * .55, -b],
            [0, -b], [a * .40, -b * .90], [a * .73, -b * .56], [a, 0],
            [a * .73, b * .56], [a * .40, b * .90], [0, b],
            [-a * .55, b], [-a * .88, b * .82], [-a, b * .56]]


def build_in_blender():
    import bpy
    from mathutils import Vector
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ship_sails import build_quad_sail, build_triangle_sail
    config = json.loads(SOURCE.read_text())
    settings = config["camera"]
    selected = os.environ.get("SKETCH_SHIP_KINDS", "").split(",")
    build = BUILD
    build.mkdir(parents=True, exist_ok=True)
    metadata = {"sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "camera": settings, "ships": {}}
    if selected != [""]:
        metadata["ships"] = json.loads((ROOT / "src/shared/generated/ship-geometry.json").read_text())["ships"]

    def material(name, color, roughness=.85, metallic=0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = (*color, 1)
        p.inputs["Roughness"].default_value = roughness
        p.inputs["Metallic"].default_value = metallic
        return m

    for kind, spec in config["ships"].items():
        if selected != [""] and kind not in selected:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        base, upper, weapon = [], [], []
        wood = material("weathered oak", (.23, .115, .06))
        hull_shades = [wood, material("sun-worn oak", (.28, .15, .078)),
                       material("lower hull oak", (.17, .082, .042))]
        plank = material("deck oak", (.39, .29, .18))
        deck_shades = [plank, material("deck oak pale", (.43, .325, .205)),
                       material("deck oak warm", (.355, .255, .153))]
        edge = material("cut oak", (.29, .18, .095))
        dark = material("tarred oak", (.07, .055, .045))
        iron = material("forged iron", (.095, .12, .13), .55, .55)
        canvas = material("unbleached sail", (.69, .64, .51))
        cloth = [canvas, material("unbleached sail sun-faded", (.72, .67, .55)),
                 material("unbleached sail warm panels", (.65, .595, .47))]
        brass = material("aged brass", (.32, .23, .105), .6, .45)
        rope = material("hemp rigging", (.26, .205, .13))
        glass = material("cabin glazing", (.075, .135, .14), .32)

        def mesh(name, vertices, faces, mat, layer):
            data = bpy.data.meshes.new(name)
            data.from_pydata(vertices, [], faces)
            data.update()
            obj = bpy.data.objects.new(name, data)
            bpy.context.collection.objects.link(obj)
            obj.data.materials.append(mat)
            layer.append(obj)
            return obj

        def box(name, at, size, mat, layer):
            bpy.ops.mesh.primitive_cube_add(size=1, location=at)
            obj = bpy.context.object
            obj.name = name
            obj.scale = size
            # Bevels are measured in world units, not in the differently scaled cube axes.
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            obj.data.materials.append(mat)
            layer.append(obj)
            bevel = obj.modifiers.new("soft worn edges", "BEVEL")
            bevel.width = min(.6, min(size) * .2)
            bevel.segments = 1
            return obj

        def cylinder(name, at, radius, height, mat, layer, rotation=None):
            bpy.ops.mesh.primitive_cylinder_add(vertices=6 if radius < .65 else 12, radius=radius, depth=height, location=at)
            obj = bpy.context.object
            obj.name = name
            if rotation:
                obj.rotation_euler = rotation
            obj.data.materials.append(mat)
            layer.append(obj)
            return obj

        def spar(name, start, end, radius, mat, layer):
            a, b = Vector(start), Vector(end)
            obj = cylinder(name, (a+b)/2, radius, (b-a).length, mat, layer)
            obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
            return obj

        def rim(name, at, radius, bore, depth, mat, layer, rotation):
            vertices = [(r*math.cos(i*math.tau/16), r*math.sin(i*math.tau/16), height)
                        for r, height in ((radius, -depth/2), (radius, depth/2),
                                          (bore, depth/2), (bore, -depth/2)) for i in range(16)]
            faces = [(row*16+i, row*16+(i+1)%16, (row+1)*16+(i+1)%16, (row+1)*16+i)
                     for row in range(3) for i in range(16)]
            obj = mesh(name, vertices, faces, mat, layer)
            obj.location = at
            obj.rotation_euler = rotation
            return obj

        length, beam, z = spec["length"], spec["beam"], spec["deckHeight"]
        hull, deck = outline(length, beam), outline(length, beam, 5)
        n = len(hull)
        # A rounded, deep hull with rising bow and stern, rather than a shallow polygon tray.
        sheer = lambda x: 6 * abs(x/(length/2))**3 + (3 if x > length*.36 else 0)
        rings = [[(x*.86, y*.52, 0) for x, y in hull],
                 [(x*.93, y*.72, z*.18 + sheer(x)*.18) for x, y in hull],
                 [(x*.98, y*.92, z*.48 + sheer(x)*.48) for x, y in hull],
                 [(x, y, z*.76 + sheer(x)*.76) for x, y in hull],
                 [(x, y, z + sheer(x)) for x, y in hull]]
        faces = [tuple(range(n-1, -1, -1))]
        for row in range(len(rings)-1):
            faces += [(row*n+i, row*n+(i+1)%n, (row+1)*n+(i+1)%n, (row+1)*n+i) for i in range(n)]
        body = mesh("round planked hull", [p for ring in rings for p in ring], faces, wood, base)
        for mat in hull_shades[1:]:
            body.data.materials.append(mat)
        for face in body.data.polygons:
            face.material_index = 2 if face.index <= n else (1 if face.index > n*3 else 0)
            face.use_smooth = face.index > 0
        bevel = body.modifiers.new("soft hull chines", "BEVEL")
        bevel.width, bevel.segments = 1.2, 2
        for height, width, mat in ((z*.35, 1.4, dark), (z*.70, 1.2, dark), (z+1, 1.7, edge)):
            for i, (x, y) in enumerate(hull):
                xx, yy = hull[(i+1)%n]
                # Follow the hull skin instead of floating a straight belt outside the bilge.
                fx, fy = (.9583, .8333) if height < z*.5 else (1, 1)
                spar("continuous hull strake", (x*fx, y*fy, height+sheer(x)*height/z),
                     (xx*fx, yy*fy, height+sheer(xx)*height/z), width/2, mat, base)
        mesh("walking deck", [[x, y, z] for x, y in deck], [tuple(range(n))], dark, base)
        def clip(points, axis, boundary, keep_above):
            result = []
            for start, end in zip(points, points[1:] + points[:1]):
                a = (start[axis] >= boundary) if keep_above else (start[axis] <= boundary)
                b = (end[axis] >= boundary) if keep_above else (end[axis] <= boundary)
                if a:
                    result.append(start)
                if a != b:
                    t = (boundary-start[axis])/(end[axis]-start[axis])
                    result.append([start[j]+(end[j]-start[j])*t for j in (0, 1)])
            return result

        # Longitudinal boards with staggered butt joints, clipped to the same physical deck.
        vertices, faces, shades = [], [], []
        for row, y in enumerate(range(int(-beam/2), int(beam/2), 5)):
            strip = clip(clip(deck, 1, y+.10, True), 1, y+4.88, False)
            for col, x in enumerate(range(int(-length/2)-36+(row%3)*12, int(length/2), 36)):
                board = clip(clip(strip, 0, x+.10, True), 0, x+35.85, False)
                if len(board) < 3:
                    continue
                faces.append(tuple(range(len(vertices), len(vertices)+len(board))))
                vertices += [(px, py, z+.05) for px, py in board]
                shades.append((row*7+col*3+col//2)%len(deck_shades))
        boards = mesh("fore and aft deck planking", vertices, faces, plank, base)
        for mat in deck_shades[1:]:
            boards.data.materials.append(mat)
        for face, shade in zip(boards.data.polygons, shades):
            face.material_index = shade
        for i, (x, y) in enumerate(hull):
            xx, yy = hull[(i+1) % n]
            mid = ((x+xx)/2, (y+yy)/2)
            rail = box("solid bulwark", (*mid, z+4+sheer(mid[0])/2), (math.hypot(xx-x, yy-y), 2.8, 8), wood, upper)
            rail.rotation_euler.z = math.atan2(yy-y, xx-x)
            spar("gunwale", (x, y, z+8+sheer(x)/2), (xx, yy, z+8+sheer(xx)/2), 1.2, edge, upper)

        spar("raking bow stem", (length/2-5, 0, 2), (length/2+1, 0, z+12), 2, dark, base)
        spar("bowsprit", (length*.37, 0, z+10), (length*.63, 0, z+21), 1.8, edge, upper)
        for y in (-beam*.22, beam*.22):
            spar("bow stays", (length*.62, 0, z+20), (length*.22, y, z+8), .4, dark, upper)

        for obstacle in spec["obstacles"]:
            x, y, r = obstacle["x"], obstacle["y"], obstacle["radius"]
            if obstacle["type"] == "mast":
                h = spec["mastHeight"]
                cylinder("mast footing", (x, y, z+1.4), r, 2.8, iron, upper)
                cylinder("mast", (x, y, z+h/2), 2.2, h, edge, upper)
                for height in (5, 9, h*.66):
                    cylinder("mast binding", (x, y, z+height), 2.35, .7, rope, upper)
                if kind in ("cutter", "fireShip", "bombardShip"):
                    # An aft-raked lateen rig, deliberately distinct from the
                    # square-rigged fighting ships; the foredeck stays visible.
                    spar("lateen yard", (x-20, -beam*.35, z+h*.92),
                         (x+40, beam*.4, z+h*.30), 1.2, edge, upper)
                    build_triangle_sail("lateen sail", [(x-19,-beam*.34,z+h*.90),
                         (x+39,beam*.39,z+h*.31),(x+18,-beam*.22,z+h*.24)],
                         beam*.12, cloth, rope, mesh, spar, upper)
                elif kind == "transport":
                    # A low, full cargo lug leaves the forward working deck open.
                    spar("lug yard", (x-17,-beam*.43,z+h*.90), (x+13,beam*.43,z+h*.79),1.3,edge,upper)
                    build_quad_sail("cargo lug sail", [(x-5,-beam*.32,z+h*.30),
                         (x+20,beam*.35,z+h*.28),(x+13,beam*.42,z+h*.77),
                         (x-17,-beam*.42,z+h*.88)], beam*.12, cloth, rope, mesh, spar, upper)
                else:
                    cylinder("lower yard", (x, y, z+h*.68), 1.2, beam*1.10, edge, upper, (math.pi/2, 0, 0))
                    build_quad_sail("canvas sail", [(x,y-beam*.46,z+h*.22),
                         (x,y+beam*.46,z+h*.22),(x,y+beam*.54,z+h*.67),
                         (x,y-beam*.54,z+h*.67)], beam*.20, cloth, rope, mesh, spar, upper)
                    cylinder("topsail yard", (x, y, z+h*.98), .9, beam*.73, edge, upper, (math.pi/2, 0, 0))
                    build_quad_sail("square topsail", [(x,y-beam*.32,z+h*.74),
                         (x,y+beam*.32,z+h*.74),(x,y+beam*.36,z+h*.97),
                         (x,y-beam*.36,z+h*.97)], beam*.09, cloth, rope, mesh, spar, upper,
                         panels=6, rows=4)
                for side in (-1, 1):
                    peak = Vector((x, y, z+h*.72))
                    feet = [Vector((x-dx, y+side*beam*.40, z+8)) for dx in (5, 18)]
                    for foot in feet:
                        spar("mast shroud", peak, foot, .38, dark, upper)
                        cylinder("shroud deadeye", foot, 1, 1.2, wood, upper, (math.pi/2, 0, 0))
                    for rung in range(1, 7):
                        t = rung/10
                        spar("shroud ratline", feet[0].lerp(peak, t), feet[1].lerp(peak, t), .18, rope, upper)
                    spar("sail sheet", (x, y+side*beam*.46, z+h*.22), (x+25, side*beam*.35, z+8), .45, dark, upper)
                if kind in ("cutter", "warship", "carrier"):
                    spar("forestay", (x, 0, z+h*.96), (length*.61, 0, z+21), .5, dark, upper)
                # Bow artillery requires open sky as well as clearance at the mast footing.
                if kind == "cutter":
                    build_triangle_sail("light jib", [(x+3,0,z+h*.78),(length*.57,0,z+24),
                         (x+24,0,z+24)], 3.5, cloth, rope, mesh, spar, upper, panels=4)
                if kind == "carrier":
                    cylinder("lookout platform",(x,0,z+h*.72),9,2,wood,upper)
                    for side in (-1,1):
                        spar("lookout rail",(x-7,side*6,z+h*.72+6),(x+7,side*6,z+h*.72+6),.7,edge,upper)
            elif obstacle["type"] == "cabin":
                height = {"cutter": 9, "fireShip": 12, "transport": 17, "bombardShip": 15, "warship": 22, "carrier": 30}[kind]
                box("sterncastle", (x, y, z+height/2), (r*1.5, r*1.35, height), wood, upper)
                box("raised quarterdeck", (x, y, z+height+1.4), (r*1.65, r*1.48, 2.8), plank, upper)
                for side in (-1, 1):
                    for dx in (-r*.38, r*.12):
                        window_z, window_y = z+height*.56, side*(r*.68+.1)
                        box("stern cabin window frame", (x+dx, window_y, window_z), (r*.29, .8, height*.40), edge, upper)
                        box("stern cabin glazing", (x+dx, window_y+side*.48, window_z), (r*.22, .16, height*.30), glass, upper)
                        box("window mullion", (x+dx, window_y+side*.60, window_z), (.45, .25, height*.32), brass, upper)
                        box("window transom", (x+dx, window_y+side*.60, window_z), (r*.23, .25, .45), edge, upper)
                    spar("quarterdeck rail", (x-r*.75, side*r*.73, z+height+6),
                         (x+r*.75, side*r*.73, z+height+6), .9, edge, upper)
                    for dx in (-r*.70, 0, r*.70):
                        spar("quarterdeck stanchion", (x+dx, side*r*.73, z+height+2),
                             (x+dx, side*r*.73, z+height+6), .6, edge, upper)
                if kind != "cutter":
                    box("stern gallery", (x-r*.8, y, z+height*.52), (3, r*1.3, height*.52), edge, upper)
                    for dy in (-r*.4, 0, r*.4):
                        box("stern gallery window", (x-r*.86, dy, z+height*.62), (.8, r*.20, height*.28), dark, upper)
                spar("stern ensign staff", (x-8, 0, z+height), (x-12, 0, z+height+20), .85, edge, upper)
            elif obstacle["type"] == "gun":
                cylinder("gun carriage", (x, y, z+2), r, 4, edge, weapon)
                cylinder("cannon", (x+8, y, z+7), 4.2, 35, iron, weapon, (0, math.pi/2, 0))
                rim("open cannon muzzle", (x+26, y, z+7), 4.4, 3.2, 1.6, brass, weapon, (0, math.pi/2, 0))
                cylinder("recessed cannon bore", (x+26.2, y, z+7), 3.2, .1, dark, weapon, (0, math.pi/2, 0))
                for dx in (-3, 16):
                    cylinder("barrel reinforcing band", (x+dx, y, z+7), 4.35, 1.2, iron, weapon, (0, math.pi/2, 0))
            elif obstacle["type"] == "mortar":
                cylinder("mortar bed", (x, y, z+2), r, 4, iron, weapon)
                cylinder("bombard barrel", (x+3, y, z+12), 9, 24, iron, weapon, (0, .45, 0))
                rim("open bombard lip", (x+8, y, z+24), 9.5, 7.6, 2.5, brass, weapon, (0, .45, 0))
                cylinder("recessed bombard bore", (x+8, y, z+24), 7.6, .1, dark, weapon, (0, .45, 0))
            else:
                box("fuel housing", (x, y, z+7), (r*1.6, r*1.3, 14), iron, weapon)
                for yy in (-r*.36, r*.36):
                    cylinder("fuel tank", (x, yy, z+9), 6, 28, brass, weapon, (0, math.pi/2, 0))
                    spar("fuel feed", (x+14,yy,z+9), (x+22,0,z+6), 1.6, brass, weapon)
                cylinder("flame nozzle", (x+26, 0, z+6), 4, 32, iron, weapon, (0, math.pi/2, 0))
                cylinder("projector mouth", (x+42,0,z+6), 5, 3, brass, weapon, (0, math.pi/2, 0))
        if kind == "cutter":
            for side in (-1,1):
                for x in (-12,4):
                    spar("lashed spare oar",(x-14,side*beam*.36,z+9),(x+14,side*beam*.38,z+10),.7,edge,upper)
        if kind == "fireShip":
            box("heat shield",(length*.17,0,z+.6),(length*.37,beam*.53,1.2),iron,base)
            for side in (-1,1):
                box("copper waterline plating",(-length*.10,side*beam*.43,z*.55),(length*.55,2,z*.45),brass,base)
        if kind == "transport":
            box("flush cargo hatch", (length*.03, 0, z+.4), (length*.37, beam*.50, .8), dark, base)
            for offset in (-beam*.15, 0, beam*.15):
                box("hatch grating", (length*.03, offset, z+1), (length*.36, .6, .5), edge, base)
        if kind in ("warship", "carrier"):
            for side in (-1, 1):
                for x in (-length*.23, 0, length*.22):
                    box("iron gunport shutter", (x, side*beam*.44, z*.68), (10, 1.8, 6), iron, base)
        if kind == "bombardShip":
            for side in (-1,1):
                box("reinforced mortar coaming", (length*.16, side*beam*.31,z+3), (length*.3,3,6), iron, upper)
        box("stern rudder", (-length/2-2, 0, z*.30), (5, 2, z*.6), dark, base)
        fittings = base + upper
        rig = bpy.data.objects.new("ship origin", None)
        bpy.context.collection.objects.link(rig)
        for obj in fittings:
            obj.parent = rig
        weapon_rig = bpy.data.objects.new("traversing weapon", None)
        bpy.context.collection.objects.link(weapon_rig)
        weapon_rig.parent = rig
        pivot = Vector(spec["weaponPivot"] or (0, 0, 0))
        weapon_rig.location = pivot
        for obj in weapon:
            obj.location -= pivot
            obj.parent = weapon_rig

        bpy.ops.wm.save_as_mainfile(filepath=str(build / (kind + ".blend")))
        metadata["ships"][kind] = {**spec, "hull": hull, "deck": deck}
        print("SHIP_MODEL", kind, flush=True)
    target = ROOT / "src/shared/generated/ship-geometry.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(metadata, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN", "blender"))
    parser.add_argument("--kinds", nargs="+", help="Build only these ship kinds")
    args = parser.parse_args()
    subprocess.run([args.blender, "--background", "--factory-startup", "--python-exit-code", "1",
                    "--python", str(Path(__file__).resolve())], check=True,
                   env={**os.environ, "SKETCH_SHIP_KINDS": ",".join(args.kinds or [])})
    print("Ship models and physical geometry exported; run export-world-gltf.py for GLBs")


if __name__ == "__main__":
    if "bpy" in sys.modules:
        build_in_blender()
    else:
        main()
