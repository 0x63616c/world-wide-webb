{ pkgs }:
pkgs.stdenvNoCC.mkDerivation rec {
  pname = "opentofu";
  version = "1.13.9";
  src = pkgs.fetchurl {
    url = "https://github.com/opentofu/opentofu/releases/download/v${version}/tofu_${version}_darwin_arm64.zip";
    hash = "sha256-KbovTHhVao0lR25QcP5HRUle9knEo7gnFw63Q20j/rM=";
  };
  nativeBuildInputs = [ pkgs.unzip ];
  sourceRoot = ".";
  dontConfigure = true;
  dontBuild = true;
  dontFixup = true;
  installPhase = ''
    install -Dm755 tofu "$out/bin/tofu"
  '';
  doInstallCheck = true;
  installCheckPhase = ''
    "$out/bin/tofu" version -json | grep -q '"terraform_version": "${version}"'
  '';
  meta = {
    description = "Pinned OpenTofu used by the Cloudflare deployment workflow";
    homepage = "https://opentofu.org";
    license = pkgs.lib.licenses.mpl20;
    platforms = [ "aarch64-darwin" ];
    mainProgram = "tofu";
  };
}
