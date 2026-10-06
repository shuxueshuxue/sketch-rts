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
        plank = material("deck oak", (.39, .29, .18))
        edge = material("cut oak", (.29, .18, .095))
        dark = material("tarred oak", (.07, .055, .045))
        iron = material("forged iron", (.095, .12, .13), .55, .55)
        canvas = material("unbleached sail", (.69, .64, .51))
        brass = material("aged brass", (.32, .23, .105), .6, .45)

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
            obj.data.materials.append(mat)
            layer.append(obj)
            bevel = obj.modifiers.new("soft worn edges", "BEVEL")
            bevel.width = .6
            bevel.segments = 1
            return obj

        def cylinder(name, at, radius, height, mat, layer, rotation=None):
            bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=height, location=at)
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

        length, beam, z = spec["length"], spec["beam"], spec["deckHeight"]
        hull, deck = outline(length, beam), outline(length, beam, 5)
        n = len(hull)
        # A rounded, deep hull with rising bow and stern, rather than a shallow polygon tray.
        sheer = lambda x: 6 * abs(x/(length/2))**3 + (3 if x > length*.36 else 0)
        rings = [[(x*.90, y*.62, 0) for x, y in hull],
                 [(x*.98, y*.90, z*.30) for x, y in hull],
                 [(x, y, z + sheer(x)) for x, y in hull]]
        faces = [tuple(range(n-1, -1, -1))]
        for row in range(len(rings)-1):
            faces += [(row*n+i, row*n+(i+1)%n, (row+1)*n+(i+1)%n, (row+1)*n+i) for i in range(n)]
        body = mesh("round planked hull", [p for ring in rings for p in ring], faces, wood, base)
        bevel = body.modifiers.new("soft hull chines", "BEVEL")
        bevel.width, bevel.segments = 1.2, 2
        for height, width, mat in ((z*.35, 1.7, dark), (z*.70, 1.4, edge), (z+1, 2, brass)):
            for i, (x, y) in enumerate(hull):
                xx, yy = hull[(i+1)%n]
                factor = .94 if height < z*.5 else 1
                spar("continuous hull strake", (x*factor, y*factor, height+sheer(x)*height/z),
                     (xx*factor, yy*factor, height+sheer(xx)*height/z), width/2, mat, base)
        mesh("walking deck", [[x, y, z] for x, y in deck], [tuple(range(n))], plank, base)
        for x in range(int(-length*.45), int(length*.45), 5):
            cuts=[]
            for i,(xx,yy) in enumerate(deck):
                nx,ny=deck[(i+1)%len(deck)]
                if min(xx,nx)<=x<=max(xx,nx) and nx!=xx:
                    cuts.append(yy+(ny-yy)*(x-xx)/(nx-xx))
            if len(cuts)>=2:
                low,high=min(cuts),max(cuts)
                box("plank seam",(x,(low+high)/2,z+.06),(.28,max(0,high-low-1),.12),edge,base)
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
                if kind in ("cutter", "fireShip"):
                    # An aft-raked lateen rig, deliberately distinct from the
                    # square-rigged fighting ships; the foredeck stays visible.
                    spar("lateen yard", (x-20, -beam*.35, z+h*.92),
                         (x+40, beam*.4, z+h*.30), 1.2, edge, upper)
                    mesh("lateen sail", [(x-19,-beam*.34,z+h*.90),
                         (x+39,beam*.39,z+h*.31),(x+18,-beam*.22,z+h*.24)],
                         [(0,1,2)],canvas,upper)
                else:
                    cylinder("lower yard", (x, y, z+h*.68), 1.2, beam*1.10, edge, upper, (math.pi/2, 0, 0))
                    # A curved sail gives a readable silhouette from every direction.
                    vertices, faces = [], []
                    for row in range(8):
                        for col in range(11):
                            u, v = col/10, row/7
                            yy = (u-.5)*beam*(.92+.16*v)
                            bulge = math.sin(u*math.pi)*math.sin(v*math.pi)*17
                            vertices.append((x+bulge, y+yy, z+h*(.22+v*.45)+math.sin(u*math.pi)*3))
                    for row in range(7):
                        for col in range(10):
                            i = row*11+col
                            faces.append((i, i+1, i+12, i+11))
                    sail = mesh("canvas sail", vertices, faces, canvas, upper)
                    solid = sail.modifiers.new("sail thickness", "SOLIDIFY")
                    solid.thickness = .18
                    if kind in ("warship", "carrier"):
                        cylinder("topsail yard", (x, y, z+h*.98), .9, beam*.73, edge, upper, (math.pi/2, 0, 0))
                        top_vertices, top_faces = [], []
                        for row in range(5):
                            for col in range(9):
                                u, v = col/8, row/4
                                top_vertices.append((x+math.sin(u*math.pi)*math.sin(v*math.pi)*7,
                                                     y+(u-.5)*beam*(.64+.08*v), z+h*(.74+v*.23)))
                        for row in range(4):
                            for col in range(8):
                                i = row*9+col
                                top_faces.append((i, i+1, i+10, i+9))
                        mesh("square topsail", top_vertices, top_faces, canvas, upper)
                for side in (-1, 1):
                    spar("mast shroud", (x, y, z+h*.72), (x-12, y+side*beam*.40, z+8), .45, dark, upper)
                    spar("sail sheet", (x, y+side*beam*.46, z+h*.22), (x+25, side*beam*.35, z+8), .45, dark, upper)
                spar("forestay", (x, 0, z+h*.96), (length*.61, 0, z+21), .5, dark, upper)
                # Broad cloth, rigging and a sterncastle remain readable at gameplay scale.
                mesh("forward staysail", [(x+3, 0, z+h*.78), (length*.57, 0, z+24), (x+24, 0, z+24)], [(0, 1, 2)], canvas, upper)
            elif obstacle["type"] == "cabin":
                height = {"cutter": 9, "fireShip": 12, "transport": 17, "bombardShip": 15, "warship": 22, "carrier": 30}[kind]
                box("sterncastle", (x, y, z+height/2), (r*1.5, r*1.35, height), wood, upper)
                box("raised quarterdeck", (x, y, z+height+1.4), (r*1.65, r*1.48, 2.8), plank, upper)
                for side in (-1, 1):
                    for dx in (-r*.38, r*.12):
                        box("stern cabin window", (x+dx, side*(r*.68+.1), z+height*.56), (r*.24, .6, height*.32), dark, upper)
                    spar("quarterdeck rail", (x-r*.75, side*r*.73, z+height+6),
                         (x+r*.75, side*r*.73, z+height+6), .9, edge, upper)
                if kind != "cutter":
                    box("stern gallery", (x-r*.8, y, z+height*.52), (3, r*1.3, height*.52), edge, upper)
                    for dy in (-r*.4, 0, r*.4):
                        box("stern gallery window", (x-r*.86, dy, z+height*.62), (.8, r*.20, height*.28), dark, upper)
                spar("stern ensign staff", (x-8, 0, z+height), (x-12, 0, z+height+20), .85, edge, upper)
            elif obstacle["type"] == "gun":
                cylinder("gun carriage", (x, y, z+2), r, 4, edge, weapon)
                cylinder("cannon", (x+8, y, z+7), 4.2, 35, iron, weapon, (0, math.pi/2, 0))
                cylinder("muzzle", (x+26, y, z+7), 4.4, 1.6, brass, weapon, (0, math.pi/2, 0))
            elif obstacle["type"] == "mortar":
                cylinder("mortar bed", (x, y, z+2), r, 4, iron, weapon)
                cylinder("bombard barrel", (x+3, y, z+12), 9, 24, iron, weapon, (0, .45, 0))
                cylinder("bombard lip", (x+8, y, z+24), 9.5, 2.5, brass, weapon, (0, .45, 0))
            else:
                box("fuel housing", (x, y, z+7), (r*1.6, r*1.3, 14), iron, weapon)
                for yy in (-r*.36, r*.36):
                    cylinder("fuel tank", (x, yy, z+9), 6, 28, brass, weapon, (0, math.pi/2, 0))
                    spar("fuel feed", (x+14,yy,z+9), (x+22,0,z+6), 1.6, brass, weapon)
                cylinder("flame nozzle", (x+26, 0, z+6), 4, 32, iron, weapon, (0, math.pi/2, 0))
                cylinder("projector mouth", (x+42,0,z+6), 5, 3, brass, weapon, (0, math.pi/2, 0))
        if kind == "transport":
            box("flush cargo hatch", (length*.03, 0, z+.4), (length*.22, beam*.44, .8), dark, base)
            for offset in (-beam*.15, 0, beam*.15):
                box("hatch grating", (length*.03, offset, z+1), (length*.21, .6, .5), edge, base)
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
