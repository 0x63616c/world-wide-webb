{ pkgs }:
{
  # API and browser routes address the same upstream bytes; retain archive names and hashes.
  # Preserve the signed app bundle and embedded provisioning profile. The
  # upstream wrapper executes Contents/MacOS/tart inside that bundle.
  tart = (pkgs.tart.override { enableSoftnet = false; }).overrideAttrs (_: {
    version = "2.41.1";
    src = pkgs.fetchurl {
      name = "tart.tar.gz";
      urls = [
        "https://api.github.com/repos/openai/tart/releases/assets/644183490"
        "https://github.com/openai/tart/releases/download/2.41.1/tart.tar.gz"
      ];
      curlOptsList = [
        "--header"
        "Accept: application/octet-stream"
      ];
      sha256 = "e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2";
    };
    dontFixup = true;
  });
  # This only packages the binary. It grants no privileged execution and is
  # not placed in a host profile until the runner controller is ready.
  softnet = pkgs.softnet.overrideAttrs (_: {
    version = "0.25.0";
    src = pkgs.fetchurl {
      name = "softnet.tar.gz";
      urls = [
        "https://api.github.com/repos/openai/softnet/releases/assets/693213678"
        "https://github.com/openai/softnet/releases/download/0.25.0/softnet.tar.gz"
      ];
      curlOptsList = [
        "--header"
        "Accept: application/octet-stream"
      ];
      sha256 = "5a2e8ef779f0a2169b88d273ee806c0d64321ec7714c0dc99bf217523ae9b008";
    };
    dontFixup = true;
  });
}
