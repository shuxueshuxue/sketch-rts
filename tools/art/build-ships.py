#!/usr/bin/env python3
"""Build editable Blender ships, geometry and 32-direction layered atlases.

Run with Python + Pillow; set BLENDER_BIN or pass --blender. Blender 4+ only
performs offline work. The game consumes the exported PNGs and geometry JSON.
"""
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
OUTPUT = ROOT / "public/art/ships"


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
    preview = os.environ.get("SKETCH_SHIP_PREVIEW") == "1"
    build = ROOT / ".art-build/ship-redesign-preview" if preview else BUILD
    build.mkdir(parents=True, exist_ok=True)
    metadata = {"sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "camera": settings, "ships": {}}

    def material(name, color, roughness=.85, metallic=0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        p = m.node_tree.nodes.get("Principled BSDF")
        p.inputs["Base Color"].default_value = (*color, 1)
        p.inputs["Roughness"].default_value = roughness
        p.inputs["Metallic"].default_value = metallic
        return m

    for kind, spec in config["ships"].items():
        if preview and kind not in ("transport", "warship"):
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
                if kind not in ("cutter", "fireShip"):
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
                height = 12 if kind == "cutter" else 25 if kind == "carrier" else 22
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
                cylinder("gun carriage", (x, y, z+2), r, 4, edge, upper)
                cylinder("cannon", (x+8, y, z+7), 4.2, 35, iron, weapon, (0, math.pi/2, 0))
                cylinder("muzzle", (x+26, y, z+7), 4.4, 1.6, brass, weapon, (0, math.pi/2, 0))
            elif obstacle["type"] == "mortar":
                cylinder("mortar bed", (x, y, z+2), r, 4, iron, upper)
                cylinder("bombard barrel", (x+3, y, z+12), 9, 24, iron, weapon, (0, .45, 0))
                cylinder("bombard lip", (x+8, y, z+24), 9.5, 2.5, brass, weapon, (0, .45, 0))
            else:
                box("fuel housing", (x, y, z+7), (r*1.6, r*1.3, 14), iron, upper)
                for yy in (-r*.36, r*.36):
                    cylinder("fuel tank", (x, yy, z+9), 6, 28, brass, upper, (0, math.pi/2, 0))
                cylinder("flame nozzle", (x+26, 0, z+6), 3, 32, iron, weapon, (0, math.pi/2, 0))
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

        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        scene.cycles.device = "CPU"
        scene.cycles.samples = 12
        scene.cycles.use_denoising = False
        scene.render.threads_mode = "FIXED"
        scene.render.threads = 4
        scene.render.resolution_x = scene.render.resolution_y = settings["frameSize"]
        scene.render.resolution_percentage = 100
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "Medium High Contrast"
        scene.view_settings.exposure = -.2
        scene.world = bpy.data.worlds.new("overcast sky")
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.45, .48, .52, 1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value = .7
        bpy.ops.object.light_add(type="AREA", location=(-80, -100, 180))
        light = bpy.context.object
        light.data.energy = 190000
        light.data.shape = "DISK"
        light.data.size = 130
        light.rotation_euler = (-light.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.ops.object.camera_add(location=(0, 220*math.sin(settings["tilt"]), 220*math.cos(settings["tilt"])))
        camera = bpy.context.object
        camera.rotation_euler = (-camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = settings["worldSize"]
        scene.camera = camera

        depth = bpy.data.materials.new("world depth")
        depth.use_nodes = True
        nodes, links = depth.node_tree.nodes, depth.node_tree.links
        nodes.clear()
        geom = nodes.new("ShaderNodeNewGeometry")
        split = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geom.outputs["Position"], split.inputs[0])
        scale = nodes.new("ShaderNodeMath")
        scale.operation = "MULTIPLY_ADD"
        links.new(split.outputs["Y"], scale.inputs[0])
        scale.inputs[1].default_value = 1/256
        scale.inputs[2].default_value = .5
        emit = nodes.new("ShaderNodeEmission")
        links.new(scale.outputs[0], emit.inputs["Color"])
        out = nodes.new("ShaderNodeOutputMaterial")
        links.new(emit.outputs[0], out.inputs[0])

        bpy.ops.wm.save_as_mainfile(filepath=str(build / (kind + ".blend")))
        for direction in ((0, 4, 8, 12) if preview else range(settings["directions"])):
            rig.rotation_euler.z = direction * math.tau / settings["directions"]
            layers = ("base", "upper", "depth", "weapon", "weapon-depth") if weapon else ("base", "upper", "depth")
            for layer in layers:
                weapon_layer = layer.startswith("weapon")
                depth_layer = layer.endswith("depth")
                rig.rotation_euler.z = 0 if weapon_layer else direction * math.tau / settings["directions"]
                weapon_rig.location = (0, 0, 0) if weapon_layer else pivot
                weapon_rig.rotation_euler.z = direction * math.tau / settings["directions"] if weapon_layer else 0
                for obj in base:
                    obj.hide_render = layer != "base"
                for obj in upper:
                    obj.hide_render = layer not in ("upper", "depth")
                for obj in weapon:
                    obj.hide_render = not weapon_layer
                scene.view_layers[0].material_override = depth if depth_layer else None
                scene.view_settings.view_transform = "Raw" if depth_layer else "Standard"
                scene.view_settings.look = "None" if depth_layer else "Medium High Contrast"
                scene.view_settings.exposure = 0 if depth_layer else -.2
                scene.render.dither_intensity = 0
                scene.render.filepath = str(build / f"{kind}-{layer}-{direction:02}.png")
                bpy.ops.render.render(write_still=True)
        metadata["ships"][kind] = {**spec, "hull": hull, "deck": deck}
        print("SHIP_BAKED", kind, flush=True)
    if preview:
        return
    target = ROOT / "src/shared/generated/ship-geometry.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(metadata, indent=2) + "\n")


def main():
    from PIL import Image, ImageOps
    from io import BytesIO
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", default=os.environ.get("BLENDER_BIN", "blender"))
    parser.add_argument("--pack-only", action="store_true")
    parser.add_argument("--preview", action="store_true", help="Render transport and warship in four directions without changing deployed atlases")
    args = parser.parse_args()
    if not args.pack_only:
        subprocess.run([args.blender, "--background", "--factory-startup", "--python-exit-code", "1",
                        "--python", str(Path(__file__).resolve())], check=True,
                       env={**os.environ, "SKETCH_SHIP_PREVIEW": "1" if args.preview else "0"})
    if args.preview:
        return
    config = json.loads(SOURCE.read_text())
    frame = config["camera"]["frameSize"]
    # Undo the orthographic camera's ground foreshortening. Physical deck x/y
    # therefore matches gameplay x/y at every heading; height still rises on screen.
    cos = math.cos(config["camera"]["tilt"])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for kind in config["ships"]:
        layers = ("base", "upper", "depth", "weapon", "weapon-depth") if config["ships"][kind]["weaponPivot"] else ("base", "upper", "depth")
        for layer in layers:
            atlas = Image.new("RGBA", (frame*8, frame*4))
            for direction in range(config["camera"]["directions"]):
                image = ImageOps.mirror(Image.open(BUILD / f"{kind}-{layer}-{direction:02}.png"))
                stretched = image.resize((frame, round(frame/cos)), Image.Resampling.NEAREST if layer.endswith("depth") else Image.Resampling.LANCZOS)
                # Reserve more space above the waterline for tall sails. The client
                # uses the same anchor, so this padding never shifts the physical deck.
                top = (stretched.height-frame)//2 - round(config["camera"].get("anchorY", 0)/config["camera"]["worldSize"]*frame)
                image = stretched.crop((0, top, frame, top+frame))
                atlas.paste(image, (direction%8*frame, direction//8*frame))
            target=OUTPUT / f"{kind}-{layer}.png"
            buffer=BytesIO();atlas.save(buffer, format="PNG", optimize=True);target.write_bytes(buffer.getvalue())
    print("Ship atlases exported to", OUTPUT)


if __name__ == "__main__":
    if "bpy" in sys.modules:
        build_in_blender()
    else:
        main()
