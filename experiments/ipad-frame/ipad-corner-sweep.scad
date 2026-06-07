// iPad Pro 12.9" corner-radius SWEEP — fit-check test pieces.
// Measured body corner radius from Apple's Accessory Design Guidelines drawing = ~12.2 mm.
// This prints several corners bracketing that value so the best fit can be picked by hand.
// Each piece is embossed with its ipad_r value. Snap each onto a real iPad corner.

/* ---- constants (match ipad-frame.scad) ---- */
clr   = 0.4;    // clearance per side (iPad <-> frame)
wall  = 3.0;    // frame wall thickness
band  = 6.4;    // band height = iPad thickness
leg   = 45;     // length of each captured edge per test piece
$fn   = 96;

/* ---- the sweep: corner radii to try (mm) ---- */
radii   = [11.5, 12.0, 12.5, 13.0, 13.5];
spacing = 56;   // grid pitch between pieces
cols    = 3;

module rrect(w, h, r) {
    hull()
        for (x = [-1, 1], y = [-1, 1])
            translate([x*(w/2 - r), y*(h/2 - r)])
                circle(r = r);
}

// one corner test piece for a given iPad corner radius, outer bbox apex at origin,
// legs running along +x and +y, embossed with its radius on the top of the +x leg.
module corner(ipad_r) {
    in_w = 214.49 + 2*clr;          // exact ADG short-edge enclosure (any value works; corner only)
    in_h = 214.49 + 2*clr;
    in_r = ipad_r + clr;
    out_r = in_r + wall;
    out_w = in_w + 2*wall;
    out_h = in_h + 2*wall;

    difference() {
        // bottom-left corner of the frame, shifted so outer apex sits at (0,0)
        intersection() {
            translate([out_w/2, out_h/2, 0])
                linear_extrude(height = band)
                    difference() {
                        rrect(out_w, out_h, out_r);
                        rrect(in_w, in_h, in_r);
                    }
            cube([leg, leg, band]);
        }
        // recessed label on top of the +x leg (leg is `wall` wide in y, centered at y=wall/2)
        translate([14, wall/2, band - 0.6])
            linear_extrude(height = 0.7)
                text(str(ipad_r), size = 2.4, halign = "left", valign = "center",
                     font = "Helvetica:style=Bold");
    }
}

for (i = [0 : len(radii) - 1])
    translate([(i % cols) * spacing, floor(i / cols) * spacing, 0])
        corner(radii[i]);
