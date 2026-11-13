The rehearsal driver supplies `vm-test.sops.yaml`, encrypted to a newly generated
disposable age identity. Its only required entry is:

```yaml
vm-rehearsal-marker: synthetic-vm-only
```

Never put the private age identity or any production credential in this directory.
