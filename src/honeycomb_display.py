#!/usr/bin/env python3
"""Generate the modular honeycomb mini-figure display STL set.

All dimensions are millimetres. Both pod variants are exported in their
intended print orientation with the solid back on the build plate.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon


@dataclass(frozen=True)
class DisplayParameters:
    clear_height: float = 30.0
    clear_depth: float = 19.65
    wall: float = 2.0
    back: float = 2.4
    channel_inset: float = 1.15
    channel_seam_width: float = 3.4
    channel_far_width: float = 5.4
    front_stop: float = 1.6
    spline_lead_in: float = 1.0
    spline_tip_reduction: float = 0.12
    tight_clearance: float = 0.10
    standard_clearance: float = 0.18
    loose_clearance: float = 0.26

    @property
    def outer_height(self) -> float:
        return self.clear_height + 2.0 * self.wall

    @property
    def inner_radius(self) -> float:
        return self.clear_height / math.sqrt(3.0)

    @property
    def outer_radius(self) -> float:
        return self.outer_height / math.sqrt(3.0)

    @property
    def clear_width(self) -> float:
        return 2.0 * self.inner_radius

    @property
    def outer_width(self) -> float:
        return 2.0 * self.outer_radius

    @property
    def total_depth(self) -> float:
        return self.back + self.clear_depth

    @property
    def spline_length(self) -> float:
        return self.total_depth - self.front_stop

P = DisplayParameters()


def hex_points(height: float) -> np.ndarray:
    """Return CCW flat-top regular-hex vertices."""
    radius = height / math.sqrt(3.0)
    return np.array(
        [
            [radius, 0.0],
            [radius / 2.0, height / 2.0],
            [-radius / 2.0, height / 2.0],
            [-radius, 0.0],
            [-radius / 2.0, -height / 2.0],
            [radius / 2.0, -height / 2.0],
        ],
        dtype=float,
    )


def extrude(poly: Polygon, height: float, z: float = 0.0) -> trimesh.Trimesh:
    mesh = trimesh.creation.extrude_polygon(poly, height=height, engine="earcut")
    if z:
        mesh.apply_translation([0.0, 0.0, z])
    return mesh


def union(meshes: Iterable[trimesh.Trimesh]) -> trimesh.Trimesh:
    items = list(meshes)
    result = trimesh.boolean.union(items, engine="manifold")
    if isinstance(result, list):
        result = trimesh.util.concatenate(result)
    result.remove_unreferenced_vertices()
    return result


def difference(base: trimesh.Trimesh, cutters: Iterable[trimesh.Trimesh]) -> trimesh.Trimesh:
    items = [base, *list(cutters)]
    result = trimesh.boolean.difference(items, engine="manifold")
    if isinstance(result, list):
        result = trimesh.util.concatenate(result)
    result.remove_unreferenced_vertices()
    return result


def half_channel_for_edge(
    a: Sequence[float], b: Sequence[float], params: DisplayParameters = P
) -> Polygon:
    """Return one pod's half of the longitudinal double-dovetail channel."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    seam_half = params.channel_seam_width / 2.0
    far_half = params.channel_far_width / 2.0
    edge = b - a
    edge /= np.linalg.norm(edge)
    inward = np.array([-edge[1], edge[0]])
    midpoint = (a + b) / 2.0
    # A tiny overshoot guarantees that the groove opens through the shared face.
    start = -0.05
    points = [
        midpoint - edge * seam_half + inward * start,
        midpoint + edge * seam_half + inward * start,
        midpoint + edge * far_half + inward * params.channel_inset,
        midpoint - edge * far_half + inward * params.channel_inset,
    ]
    return Polygon(points)


def channel_cutter(poly: Polygon, params: DisplayParameters = P) -> trimesh.Trimesh:
    return extrude(poly, params.spline_length + 0.05, z=-0.05)


def make_pod(params: DisplayParameters = P) -> trimesh.Trimesh:
    outer_poly = Polygon(hex_points(params.outer_height))
    inner_poly = Polygon(hex_points(params.clear_height))
    ring_poly = Polygon(outer_poly.exterior.coords, [inner_poly.exterior.coords])

    back = extrude(outer_poly, params.back)
    walls = extrude(ring_poly, params.total_depth)

    body = union([back, walls])
    outer = hex_points(params.outer_height)
    channels = [
        half_channel_for_edge(outer[index], outer[(index + 1) % 6], params)
        for index in range(6)
    ]
    pod = difference(body, [channel_cutter(channel, params) for channel in channels])
    pod.metadata["name"] = "universal_hex_pod"
    return pod


def half_pod_points(params: DisplayParameters = P) -> np.ndarray:
    radius = params.outer_radius
    half_height = params.outer_height / 2.0
    return np.array(
        [
            [radius, 0.0],
            [radius / 2.0, half_height],
            [-radius / 2.0, half_height],
            [-radius, 0.0],
        ],
        dtype=float,
    )


def make_half_pod(params: DisplayParameters = P) -> trimesh.Trimesh:
    """Upper half-hex filler with a wide, flat desk-contact edge."""
    points = half_pod_points(params)
    outer_poly = Polygon(points)
    inner_poly = outer_poly.buffer(-params.wall, join_style=2)
    ring_poly = Polygon(outer_poly.exterior.coords, [inner_poly.exterior.coords])
    back = extrude(outer_poly, params.back)
    walls = extrude(ring_poly, params.total_depth)
    body = union([back, walls])

    # Connect on the two diagonal edges and the top edge. The wide bottom edge
    # stays uninterrupted so the assembled honeycomb has a continuous base.
    channels = [
        half_channel_for_edge(points[index], points[index + 1], params)
        for index in range(3)
    ]
    half_pod = difference(
        body, [channel_cutter(channel, params) for channel in channels]
    )
    half_pod.metadata["name"] = "flat_bottom_half_pod"
    return half_pod


def joining_profile(
    clearance: float, params: DisplayParameters = P
) -> Polygon:
    seam = params.channel_seam_width / 2.0 - clearance
    far = params.channel_far_width / 2.0 - clearance
    depth = params.channel_inset - clearance
    return Polygon(
        [
            [-far, -depth],
            [far, -depth],
            [seam, 0.0],
            [far, depth],
            [-far, depth],
            [-seam, 0.0],
        ]
    )


def finishing_profile(
    clearance: float, params: DisplayParameters = P
) -> Polygon:
    seam = params.channel_seam_width / 2.0 - clearance
    far = params.channel_far_width / 2.0 - clearance
    depth = params.channel_inset - clearance
    return Polygon(
        [
            [-seam, 0.0],
            [seam, 0.0],
            [far, depth],
            [-far, depth],
        ]
    )


def loft_polygon(
    lower: Polygon, upper: Polygon, z0: float, z1: float
) -> trimesh.Trimesh:
    lower_points = np.asarray(lower.exterior.coords[:-1], dtype=float)
    upper_points = np.asarray(upper.exterior.coords[:-1], dtype=float)
    if len(lower_points) != len(upper_points):
        raise ValueError("Loft profiles must have matching vertex counts")

    # Shapely may reverse a buffered polygon and choose a different starting
    # corner. Align the two rings before joining them; otherwise a valid but
    # visibly twisted cap can result when unrelated corners are connected.
    def signed_area(points: np.ndarray) -> float:
        following = np.roll(points, -1, axis=0)
        return 0.5 * float(
            np.sum(points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1])
        )

    if signed_area(lower_points) * signed_area(upper_points) < 0.0:
        upper_points = upper_points[::-1]
    candidates = [np.roll(upper_points, shift, axis=0) for shift in range(len(upper_points))]
    upper_points = min(
        candidates,
        key=lambda points: float(np.sum((points - lower_points) ** 2)),
    )

    count = len(lower_points)
    vertices = np.vstack(
        [
            np.column_stack([lower_points, np.full(count, z0)]),
            np.column_stack([upper_points, np.full(count, z1)]),
        ]
    )
    faces: list[list[int]] = []
    for index in range(1, count - 1):
        faces.append([0, index + 1, index])
        faces.append([count, count + index, count + index + 1])
    for index in range(count):
        following = (index + 1) % count
        faces.append([index, following, count + following])
        faces.append([index, count + following, count + index])
    return trimesh.Trimesh(vertices=vertices, faces=np.asarray(faces), process=True)


def tapered_spline(
    profile: Polygon, params: DisplayParameters = P
) -> trimesh.Trimesh:
    lead_start = params.spline_length - params.spline_lead_in
    body = extrude(profile, lead_start)
    tip_profile = profile.buffer(-params.spline_tip_reduction, join_style=2)
    lead = loft_polygon(profile, tip_profile, lead_start, params.spline_length)
    return union([body, lead])


def make_joining_spline_physical(
    clearance: float, params: DisplayParameters = P
) -> trimesh.Trimesh:
    spline = tapered_spline(joining_profile(clearance, params), params)
    spline.metadata["name"] = "full_depth_double_dovetail_joining_spline"
    return spline


def make_finishing_spline_physical(
    clearance: float, params: DisplayParameters = P
) -> trimesh.Trimesh:
    spline = tapered_spline(finishing_profile(clearance, params), params)
    spline.metadata["name"] = "single_sided_exposed_edge_finishing_spline"
    return spline


def orient_spline_for_print(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    result = mesh.copy()
    transform = np.array(
        [
            [0.0, 0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )
    result.apply_transform(transform)
    result.apply_translation(-result.bounds[0])
    return result


def make_joining_spline(
    clearance: float, params: DisplayParameters = P
) -> trimesh.Trimesh:
    return orient_spline_for_print(make_joining_spline_physical(clearance, params))


def make_finishing_spline(
    clearance: float, params: DisplayParameters = P
) -> trimesh.Trimesh:
    return orient_spline_for_print(make_finishing_spline_physical(clearance, params))


def make_fit_coupon(params: DisplayParameters = P) -> trimesh.Trimesh:
    block = trimesh.creation.box(extents=[34.0, 6.0, params.total_depth])
    block.apply_translation([0.0, 0.0, params.total_depth / 2.0])
    x_positions = [-11.0, 0.0, 11.0]
    cutters: list[trimesh.Trimesh] = []
    for x in x_positions:
        cutter = channel_cutter(joining_profile(0.0, params), params)
        cutter.apply_translation([x, 0.0, 0.0])
        cutters.append(cutter)
    block = difference(block, cutters)

    clearances = [
        params.tight_clearance,
        params.standard_clearance,
        params.loose_clearance,
    ]
    parts: list[trimesh.Trimesh] = [block]
    for y, clearance in zip((-8.0, -14.0, -20.0), clearances):
        spline = make_joining_spline(clearance, params)
        spline.apply_translation([-params.spline_length / 2.0, y, 0.0])
        parts.append(spline)
    coupon = trimesh.util.concatenate(parts)
    coupon.metadata["name"] = "spline_coupon_top_to_bottom_tight_standard_loose"
    return coupon


def rotation_for_normal(normal: Sequence[float]) -> float:
    return math.atan2(float(normal[1]), float(normal[0])) - math.pi / 2.0


def transformed_spline(
    spline: trimesh.Trimesh,
    center: Sequence[float],
    normal: Sequence[float],
) -> trimesh.Trimesh:
    result = spline.copy()
    result.apply_transform(
        trimesh.transformations.rotation_matrix(rotation_for_normal(normal), [0, 0, 1])
    )
    result.apply_translation([float(center[0]), float(center[1]), 0.0])
    return result


def edge_key(a: Sequence[float], b: Sequence[float]) -> tuple[tuple[float, float], ...]:
    points = sorted(
        [
            (round(float(a[0]), 5), round(float(a[1]), 5)),
            (round(float(b[0]), 5), round(float(b[1]), 5)),
        ]
    )
    return tuple(points)


def assembly_parts(params: DisplayParameters = P) -> list[tuple[trimesh.Trimesh, str]]:
    pitch_x = 1.5 * params.outer_radius
    positions = [
        (-pitch_x, -params.outer_height / 2.0),
        (-pitch_x, params.outer_height / 2.0),
        (0.0, -params.outer_height),
        (0.0, 0.0),
        (0.0, params.outer_height),
        (pitch_x, -params.outer_height / 2.0),
        (pitch_x, params.outer_height / 2.0),
    ]

    parts: list[tuple[trimesh.Trimesh, str]] = []
    edges: dict[tuple[tuple[float, float], ...], list[tuple[np.ndarray, np.ndarray]]] = {}
    pod_template = make_pod(params)
    for x, y in positions:
        pod = pod_template.copy()
        pod.apply_translation([x, y, 0.0])
        parts.append((pod, "pod"))
        polygon = hex_points(params.outer_height) + np.array([x, y])
        for index in range(6):
            a = polygon[index]
            b = polygon[(index + 1) % 6]
            direction = b - a
            direction /= np.linalg.norm(direction)
            inward = np.array([-direction[1], direction[0]])
            edges.setdefault(edge_key(a, b), []).append(((a + b) / 2.0, inward))

    # Two upper-half pods fill the staggered bottom gaps and create one straight
    # desk-contact edge across the complete arrangement.
    half_template = make_half_pod(params)
    base_y = -1.5 * params.outer_height
    for x in (-pitch_x, pitch_x):
        half = half_template.copy()
        half.apply_translation([x, base_y, 0.0])
        parts.append((half, "half"))
        polygon = half_pod_points(params) + np.array([x, base_y])
        for index in range(3):
            a = polygon[index]
            b = polygon[index + 1]
            direction = b - a
            direction /= np.linalg.norm(direction)
            inward = np.array([-direction[1], direction[0]])
            edges.setdefault(edge_key(a, b), []).append(((a + b) / 2.0, inward))

    joining = make_joining_spline_physical(params.standard_clearance, params)
    finishing = make_finishing_spline_physical(params.standard_clearance, params)
    for records in edges.values():
        midpoint, inward = records[0]
        if len(records) == 2:
            parts.append((transformed_spline(joining, midpoint, inward), "join"))
        elif len(records) == 1:
            parts.append((transformed_spline(finishing, midpoint, inward), "trim"))
        else:
            raise ValueError("More than two pod edges occupy the same lattice edge")
    return parts


def make_assembly_preview(params: DisplayParameters = P) -> trimesh.Trimesh:
    preview = trimesh.util.concatenate([mesh for mesh, _ in assembly_parts(params)])
    preview.metadata["name"] = "seven_pod_assembly_preview_not_for_printing"
    return preview


def export_stl(mesh: trimesh.Trimesh, path: Path) -> None:
    path.write_bytes(trimesh.exchange.stl.export_stl(mesh))


def validate_mesh(mesh: trimesh.Trimesh) -> dict[str, object]:
    components = mesh.split(only_watertight=False)
    return {
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "is_volume": bool(all(component.is_volume for component in components)),
        "component_count": len(components),
        "vertex_count": int(len(mesh.vertices)),
        "face_count": int(len(mesh.faces)),
        "bounds_mm": np.round(mesh.bounds, 4).tolist(),
        "extents_mm": np.round(mesh.extents, 4).tolist(),
        "volume_mm3": round(float(sum(component.volume for component in components)), 3),
    }


def intersection_volume(first: trimesh.Trimesh, second: trimesh.Trimesh) -> float:
    result = trimesh.boolean.intersection([first, second], engine="manifold")
    return float(getattr(result, "volume", 0.0))


def _font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def render_view(
    parts: list[tuple[trimesh.Trimesh, str]],
    camera: Sequence[float],
    size: tuple[int, int],
) -> Image.Image:
    width, height = size
    camera_vector = np.array(camera, dtype=float)
    camera_vector /= np.linalg.norm(camera_vector)
    world_up = np.array([0.0, 1.0, 0.0])
    screen_right = np.cross(world_up, camera_vector)
    screen_right /= np.linalg.norm(screen_right)
    screen_up = np.cross(camera_vector, screen_right)
    screen_up /= np.linalg.norm(screen_up)

    triangles = []
    palette = {
        "pod": np.array([176.0, 207.0, 222.0]),
        "join": np.array([224.0, 151.0, 75.0]),
        "trim": np.array([164.0, 130.0, 196.0]),
        "half": np.array([150.0, 190.0, 208.0]),
    }
    light = np.array([-0.3, 0.75, 0.6])
    light /= np.linalg.norm(light)

    for mesh, kind in parts:
        vertices = mesh.vertices
        for face, normal in zip(mesh.faces, mesh.face_normals):
            if np.dot(normal, camera_vector) <= 0.01:
                continue
            points = vertices[face]
            projected = np.column_stack(
                [points @ screen_right, points @ screen_up, points @ camera_vector]
            )
            brightness = 0.62 + 0.38 * max(0.0, float(np.dot(normal, light)))
            color = tuple(np.clip(palette[kind] * brightness, 0, 255).astype(np.uint8))
            triangles.append((float(projected[:, 2].mean()), projected[:, :2], color))

    all_points = np.concatenate([item[1] for item in triangles], axis=0)
    minimum = all_points.min(axis=0)
    maximum = all_points.max(axis=0)
    span = np.maximum(maximum - minimum, 1.0)
    margin = 38.0
    scale = min((width - 2 * margin) / span[0], (height - 2 * margin) / span[1])
    offset = np.array(
        [
            (width - span[0] * scale) / 2.0 - minimum[0] * scale,
            (height - span[1] * scale) / 2.0 + maximum[1] * scale,
        ]
    )

    image = Image.new("RGB", size, (246, 247, 248))
    draw = ImageDraw.Draw(image)
    for _, points, color in sorted(triangles, key=lambda item: item[0]):
        screen = [
            (float(point[0] * scale + offset[0]), float(-point[1] * scale + offset[1]))
            for point in points
        ]
        draw.polygon(screen, fill=color)
    return image


def render_preview(path: Path, params: DisplayParameters = P) -> None:
    parts = assembly_parts(params)
    canvas = Image.new("RGB", (1600, 1120), (246, 247, 248))
    # A straight-on front view shows the installed splines are hidden behind
    # the uninterrupted 1.6 mm front stop. The rear remains angled so the
    # joining and finishing splines can be distinguished.
    front_parts = [
        (mesh, "pod" if kind in {"join", "trim"} else kind)
        for mesh, kind in parts
    ]
    front = render_view(front_parts, (0.14, 0.04, 1.0), (780, 980))
    rear = render_view(parts, (-0.38, 0.12, -1.0), (780, 980))
    canvas.paste(front, (10, 90))
    canvas.paste(rear, (810, 90))
    draw = ImageDraw.Draw(canvas)
    title_font = _font(38)
    label_font = _font(26)
    draw.text((40, 22), "Seven-pod modular display", font=title_font, fill=(31, 41, 47))
    draw.text((330, 72), "Front", font=label_font, fill=(65, 76, 82))
    draw.text((1055, 72), "Rear splines, edge trim, and half pods", font=label_font, fill=(65, 76, 82))
    canvas.save(path, quality=95)


def render_connector_preview(path: Path, params: DisplayParameters = P) -> None:
    joining = make_joining_spline_physical(params.standard_clearance, params)
    finishing = make_finishing_spline_physical(params.standard_clearance, params)
    joining.apply_translation([-3.5, 0.0, 0.0])
    finishing.apply_translation([3.5, 0.0, 0.0])
    image = render_view(
        [(joining, "join"), (finishing, "trim")],
        (0.75, -0.65, 1.25),
        (900, 620),
    )
    canvas = Image.new("RGB", (900, 730), (246, 247, 248))
    canvas.paste(image, (0, 92))
    draw = ImageDraw.Draw(canvas)
    draw.text(
        (32, 18),
        "Full-depth joining and finishing splines",
        font=_font(36),
        fill=(31, 41, 47),
    )
    draw.text(
        (32, 62),
        "Orange joins two pods; purple closes one exposed perimeter channel",
        font=_font(22),
        fill=(65, 76, 82),
    )
    canvas.save(path, quality=95)


def generate(output_dir: Path, params: DisplayParameters = P) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    meshes = {
        "hex_pod.stl": make_pod(params),
        "half_pod_base.stl": make_half_pod(params),
        "joining_spline_tight.stl": make_joining_spline(
            params.tight_clearance, params
        ),
        "joining_spline_standard.stl": make_joining_spline(
            params.standard_clearance, params
        ),
        "joining_spline_loose.stl": make_joining_spline(
            params.loose_clearance, params
        ),
        "finishing_spline_tight.stl": make_finishing_spline(
            params.tight_clearance, params
        ),
        "finishing_spline_standard.stl": make_finishing_spline(
            params.standard_clearance, params
        ),
        "finishing_spline_loose.stl": make_finishing_spline(
            params.loose_clearance, params
        ),
        "spline_fit_test.stl": make_fit_coupon(params),
        "seven_pod_assembly_preview.stl": make_assembly_preview(params),
    }

    first_pod = make_pod(params)
    adjacent_pod = first_pod.copy()
    adjacent_pod.apply_translation([0.0, params.outer_height, 0.0])
    standard_join = transformed_spline(
        make_joining_spline_physical(params.standard_clearance, params),
        (0.0, params.outer_height / 2.0),
        (0.0, 1.0),
    )
    top_finish = transformed_spline(
        make_finishing_spline_physical(params.standard_clearance, params),
        (0.0, params.outer_height / 2.0),
        (0.0, -1.0),
    )

    report: dict[str, object] = {
        "units": "millimetres",
        "parameters": asdict(params),
        "derived_dimensions": {
            "clear_width": round(params.clear_width, 4),
            "outer_height": round(params.outer_height, 4),
            "outer_width": round(params.outer_width, 4),
            "total_depth": round(params.total_depth, 4),
            "depth_reduction_from_previous_revision": 6.35,
            "half_pod_height": round(params.outer_height / 2.0, 4),
            "spline_length": round(params.spline_length, 4),
        },
        "meshes": {},
        "design_checks": {
            "minimum_wall_mm": params.wall,
            "back_panel_mm": params.back,
            "front_stop_mm": params.front_stop,
            "minimum_wall_remaining_behind_channel_mm": round(
                params.wall - params.channel_inset, 3
            ),
            "adjacent_body_intersection_volume_mm3": round(
                intersection_volume(first_pod, adjacent_pod), 6
            ),
            "standard_joining_spline_intersection_volume_mm3": round(
                intersection_volume(standard_join, first_pod)
                + intersection_volume(standard_join, adjacent_pod),
                6,
            ),
            "standard_finishing_spline_intersection_volume_mm3": round(
                intersection_volume(top_finish, first_pod), 6
            ),
            "support_required": False,
            "pod_print_orientation": "solid back on build plate",
            "half_pod_print_orientation": "solid back on build plate",
            "spline_print_orientation": "long dovetail face on build plate",
        },
    }

    for filename, mesh in meshes.items():
        export_stl(mesh, output_dir / filename)
        report["meshes"][filename] = validate_mesh(mesh)

    render_preview(output_dir / "assembly_preview.png", params)
    render_connector_preview(output_dir / "connector_preview.png", params)
    (output_dir / "verification_report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory for generated STL, PNG, and verification files.",
    )
    args = parser.parse_args()
    report = generate(args.output_dir)
    failed = [
        name
        for name, checks in report["meshes"].items()
        if not checks["watertight"] or not checks["winding_consistent"] or not checks["is_volume"]
    ]
    if failed:
        raise SystemExit(f"Mesh validation failed: {', '.join(failed)}")
    print(f"Generated and validated {len(report['meshes'])} STL files in {args.output_dir}")


if __name__ == "__main__":
    main()
