// Corner fit-check test piece, cut from the iPad Pro 12.9" skeleton frame.
// All four corners of the rounded-rect frame are identical, so ONE corner piece
// validates corner radius + clearance + wall for the whole frame. Cheap + fast.
// Snap it onto a real iPad corner to confirm fit before committing to the full part.

/* ---- must match ipad-frame.scad ---- */
ipad_w  = 280.6;
ipad_h  = 214.9;
ipad_d  = 6.4;
ipad_r  = 17;
clr   = 0.4;
wall  = 3.0;
band  = ipad_d;
$fn = 96;

leg = 60;   // how far the test piece extends along each edge from the corner

/* ---- derived (same as full frame) ---- */
in_w = ipad_w + 2*clr;
in_h = ipad_h + 2*clr;
in_r = ipad_r + clr;
out_w = in_w + 2*wall;
out_h = in_h + 2*wall;
out_r = in_r + wall;

module rrect(w, h, r) {
    hull()
        for (x = [-1, 1], y = [-1, 1])
            translate([x*(w/2 - r), y*(h/2 - r)])
                circle(r = r);
}

module frame_solid() {
    linear_extrude(height = band)
        difference() {
            rrect(out_w, out_h, out_r);
            rrect(in_w, in_h, in_r);
        }
}

// cut the +x/+y corner, then move it back to the origin for printing
translate([-(out_w/2 - leg), -(out_h/2 - leg), 0])
intersection() {
    frame_solid();
    translate([out_w/2 - leg, out_h/2 - leg, -1])
        cube([leg + 1, leg + 1, band + 2]);
}
