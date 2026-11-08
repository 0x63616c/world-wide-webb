"""Independent RK4 reference for the analytic Swift model; hours and mg.
Reference parameters and limitations: docs/MEDICATION-MODEL.md.
Run: python3 scripts/absorption_reference.py
"""
PARAMETERS = {
    'semaglutide': (0.0253, 0.0348, 3.59, 0.304, 4.10, 0.847),
    'tirzepatide': (0.0373, 0.0329, 2.47, 0.126, 3.98, 0.8),
}

def reference(parameters):
    ka, cl, vc, q, vp, f = parameters
    def derivative(y):
        depot, central, peripheral = y
        transfer = q * (central / vc - peripheral / vp)
        return [-ka * depot, ka * depot - cl / vc * central - transfer, transfer]
    y = [f, 0., 0.]
    step = 0.01
    for i in range(1, 33601):
        k1 = derivative(y)
        k2 = derivative([a + step*b/2 for a,b in zip(y,k1)])
        k3 = derivative([a + step*b/2 for a,b in zip(y,k2)])
        k4 = derivative([a + step*b for a,b in zip(y,k3)])
        y = [a + step*(b+2*c+2*d+e)/6 for a,b,c,d,e in zip(y,k1,k2,k3,k4)]
        if i in (100, 2400, 7200, 16800, 33600):
            print(f'{i*step:g} hours: {y[1]+y[2]:.12f} mg (central {y[1]:.12f})')

if __name__ == '__main__':
    for name, parameters in PARAMETERS.items():
        print(name)
        reference(parameters)
