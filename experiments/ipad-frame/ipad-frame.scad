// iPad Pro 12.9" (3rd-6th gen) skeleton fit-check frame
// A thin rounded-rectangle band that hugs the iPad's outer edge.
// Open front AND back, NO retaining lip - the iPad drops straight through.
// Purpose: verify footprint + corner-radius + clearance before adding a real lip.

/* ---- iPad dimensions (12.9" Pro, flat-edge body) ---- */
ipad_w  = 280.6;  // width  (long edge, landscape)
ipad_h  = 214.9;  // height (short edge)
ipad_d  = 6.4;    // thickness (5th/6th gen = 6.4; 3rd/4th = 5.9). Using thicker to be safe.
ipad_r  = 12;     // body corner radius — measured from Apple ADG drawing (~12.2) + confirmed by print sweep

/* ---- fit / frame params (tweak these) ---- */
clr   = 0.4;   // clearance per side between iPad and frame (print tolerance)
wall  = 3.0;   // frame wall thickness (the visible border width)
band  = ipad_d;// height of the band = iPad thickness (flush, no lip)

$fn = 96;      // curve smoothness

/* ---- derived ---- */
in_w = ipad_w + 2*clr;          // inner cavity
in_h = ipad_h + 2*clr;
in_r = ipad_r + clr;
out_w = in_w + 2*wall;          // outer profile
out_h = in_h + 2*wall;
out_r = in_r + wall;

module rrect(w, h, r) {
    hull()
        for (x = [-1, 1], y = [-1, 1])
            translate([x*(w/2 - r), y*(h/2 - r)])
                circle(r = r);
}

// the frame: outer rounded rect minus inner rounded rect, extruded to band height
linear_extrude(height = band)
    difference() {
        rrect(out_w, out_h, out_r);
        rrect(in_w, in_h, in_r);
    }
