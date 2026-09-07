import unittest

import numpy as np
import trimesh

import honeycomb_display as model


def intersection_volume(first, second):
    result = trimesh.boolean.intersection([first, second], engine="manifold")
    return float(getattr(result, "volume", 0.0))


class HoneycombGeometryTests(unittest.TestCase):
    def test_agreed_dimensions(self):
        self.assertAlmostEqual(model.P.clear_height, 30.0, places=4)
        self.assertAlmostEqual(model.P.clear_width, 34.641016, places=4)
        self.assertAlmostEqual(model.P.outer_height, 34.0, places=4)
        self.assertAlmostEqual(model.P.outer_width, 39.259819, places=4)
        self.assertAlmostEqual(model.P.total_depth, 22.05, places=4)
        self.assertAlmostEqual(model.P.clear_depth, 19.65, places=4)
        self.assertAlmostEqual(model.P.spline_length, 20.45, places=4)
        self.assertAlmostEqual(model.P.front_stop, 1.6, places=4)

    def test_pod_is_single_closed_volume(self):
        pod = model.make_pod()
        self.assertTrue(pod.is_watertight)
        self.assertTrue(pod.is_winding_consistent)
        self.assertTrue(pod.is_volume)
        np.testing.assert_allclose(pod.extents, [39.259819, 34.0, 22.05], atol=0.0002)

    def test_adjacent_pods_touch_without_overlap(self):
        first = model.make_pod()
        second = first.copy()
        second.apply_translation([0.0, model.P.outer_height, 0.0])
        self.assertAlmostEqual(intersection_volume(first, second), 0.0, places=6)

    def test_joining_spline_fits_both_pods_without_body_interference(self):
        first = model.make_pod()
        second = first.copy()
        second.apply_translation([0.0, model.P.outer_height, 0.0])
        spline = model.transformed_spline(
            model.make_joining_spline_physical(model.P.standard_clearance),
            (0.0, model.P.outer_height / 2.0),
            (0.0, 1.0),
        )
        self.assertAlmostEqual(intersection_volume(spline, first), 0.0, places=6)
        self.assertAlmostEqual(intersection_volume(spline, second), 0.0, places=6)
        self.assertAlmostEqual(float(spline.bounds[0, 2]), 0.0, places=6)
        self.assertAlmostEqual(
            float(spline.bounds[1, 2]), model.P.spline_length, delta=0.000002
        )

    def test_finishing_spline_fits_exposed_channel_and_is_flush(self):
        pod = model.make_pod()
        spline = model.transformed_spline(
            model.make_finishing_spline_physical(model.P.standard_clearance),
            (0.0, model.P.outer_height / 2.0),
            (0.0, -1.0),
        )
        self.assertAlmostEqual(intersection_volume(spline, pod), 0.0, places=6)
        self.assertAlmostEqual(float(spline.bounds[1, 1]), 17.0, places=6)
        self.assertAlmostEqual(float(spline.bounds[1, 2]), 20.45, delta=0.000002)

    def test_half_pod_fills_vertical_and_diagonal_base_gaps(self):
        half = model.make_half_pod()

        pod_above = model.make_pod()
        pod_above.apply_translation([0.0, model.P.outer_height, 0.0])
        top_spline = model.transformed_spline(
            model.make_joining_spline_physical(model.P.standard_clearance),
            (0.0, model.P.outer_height / 2.0),
            (0.0, 1.0),
        )

        pitch_x = 1.5 * model.P.outer_radius
        diagonal_pod = model.make_pod()
        diagonal_pod.apply_translation([pitch_x, model.P.outer_height / 2.0, 0.0])
        diagonal = np.array([pitch_x, model.P.outer_height / 2.0])
        diagonal_spline = model.transformed_spline(
            model.make_joining_spline_physical(model.P.standard_clearance),
            diagonal / 2.0,
            diagonal / np.linalg.norm(diagonal),
        )

        for neighbor, spline in (
            (pod_above, top_spline),
            (diagonal_pod, diagonal_spline),
        ):
            self.assertLess(intersection_volume(half, neighbor), 0.001)
            self.assertLess(intersection_volume(spline, half), 0.001)
            self.assertLess(intersection_volume(spline, neighbor), 0.001)

        self.assertAlmostEqual(float(half.bounds[0, 1]), 0.0, places=6)
        self.assertAlmostEqual(float(half.bounds[1, 1]), 17.0, places=6)

    def test_clearance_variants_are_ordered(self):
        tight = model.make_joining_spline_physical(model.P.tight_clearance)
        standard = model.make_joining_spline_physical(model.P.standard_clearance)
        loose = model.make_joining_spline_physical(model.P.loose_clearance)
        self.assertGreater(tight.volume, standard.volume)
        self.assertGreater(standard.volume, loose.volume)

    def test_taper_lofts_connect_corresponding_corners(self):
        for profile in (
            model.joining_profile(model.P.standard_clearance),
            model.finishing_profile(model.P.standard_clearance),
        ):
            tip = profile.buffer(-model.P.spline_tip_reduction, join_style=2)
            lead = model.loft_polygon(profile, tip, 0.0, model.P.spline_lead_in)
            vertices = lead.vertices
            cross_layer_neighbors = {index: [] for index in range(len(vertices))}
            for first, second in lead.edges_unique:
                z_first = vertices[first, 2]
                z_second = vertices[second, 2]
                if abs(z_first - z_second) > 0.9 * model.P.spline_lead_in:
                    length = float(np.linalg.norm(vertices[first] - vertices[second]))
                    cross_layer_neighbors[first].append(length)
                    cross_layer_neighbors[second].append(length)
            nearest_cross_layer = [
                min(lengths)
                for lengths in cross_layer_neighbors.values()
                if lengths
            ]
            self.assertEqual(len(nearest_cross_layer), len(vertices))
            self.assertLess(max(nearest_cross_layer), 1.2)

    def test_print_orientations_start_on_build_plate(self):
        meshes = [model.make_pod(), model.make_half_pod(), model.make_fit_coupon()]
        for clearance in (
            model.P.tight_clearance,
            model.P.standard_clearance,
            model.P.loose_clearance,
        ):
            meshes.append(model.make_joining_spline(clearance))
            meshes.append(model.make_finishing_spline(clearance))
        for mesh in meshes:
            self.assertAlmostEqual(float(mesh.bounds[0, 2]), 0.0, places=6)


if __name__ == "__main__":
    unittest.main()
