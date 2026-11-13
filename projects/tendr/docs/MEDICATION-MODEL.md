# Medication estimate model

## Decision

Use fixed reference profiles from published two-compartment injection models, with first-order absorption and elimination. The displayed quantity is **absorbed systemic amount (central + peripheral), in mg**, excluding the injection depot. It is neither measured plasma concentration nor exact total drug in a person's body. The model does not recommend doses.

| Parameter | Semaglutide | Tirzepatide |
|---|---:|---:|
| Absorption ka, /hour | 0.0253 | 0.0373 |
| Clearance CL, L/hour | 0.0348 | 0.0329 |
| Central volume Vc, L | 3.59 | 2.47 |
| Intercompartmental clearance Q, L/hour | 0.304 | 0.126 |
| Peripheral volume Vp, L | 4.10 | 3.98 |
| Bioavailability F | 0.847 | 0.8 |

Semaglutide: [Overgaard et al., 2019, Table 4](https://doi.org/10.1007/s13300-019-0581-y). We use the table's reference parameters, not the abstract's T2D interpretation. The paper defines an 85 kg healthy reference subject, abdominal injection, and 1.34 mg/mL product. Its covariate adjustments are not implemented. In particular, we do not interpolate a formulation-dependent absorption rate for compounded vials such as 5 mg/mL.

Tirzepatide: [Schneck et al., 2024, Table 3](https://doi.org/10.1002/psp4.13099). We use the 70 kg reference structural parameters and reference F=0.8. The paper's between-study bioavailability adjustment and body-composition covariates are not applied. This is a reference profile, not a reproduction of the full population simulation.

These fixed profiles omit patient variability, body-size adjustment, glycaemic status, injection site, formulation effects and residual-error simulation. They improve the shape's physiological basis without establishing individual accuracy. We do not draw an invented confidence band.

## Equations and implementation

For a dose D at t=0 (hours): depot G(0)=F*D; central C(0)=0; peripheral P(0)=0.

```
dG/dt = -ka*G
dC/dt = ka*G - (CL/Vc + Q/Vc)*C + Q/Vp*P
dP/dt = Q/Vc*C - Q/Vp*P
output = C + P
```

Swift evaluates the closed-form solution using the two disposition eigenvalues and the absorption convolution. `expm1` limits cancellation near injection time. This avoids a numerical integration loop on every live refresh. Contributions from separate doses are added linearly.

Only matching medication names participate. Taken records must not be dated in the future. Explicit future plans contribute only to their future projection; skipped records and past unfulfilled plans never contribute. **The existing medication-name identity bug is separate and still outstanding.** Schedules without dose amounts do not generate hypothetical injections.

Recognised injection names choose their matching reference model for existing journals. Unknown names retain the old immediate-absorption half-life model. Treatment details expose the selected model; only the simple half-life mode exposes the editable half-life. Existing custom half-life values are retained in storage.

## Verification

`scripts/absorption_reference.py` independently integrates the ODEs with RK4 at 0.01-hour steps. XCTest compares both analytic profiles with fixed reference values at 1, 24, 72, 168 and 336 hours to 1e-9 mg, and verifies zero absorbed amount at injection time. Separate coverage verifies future-plan inclusion and exclusion of skipped, unrelated and future-taken records. This validates the implementation, not clinical accuracy.

Live precision is configurable from 3–7 decimal places (existing default 5), persisted locally. It affects formatting only. Seven digits will often change each second; a peak or very low remaining amount may change more slowly.
