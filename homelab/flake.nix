{
  description = "Calum's declarative macOS homelab";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin.url = "github:nix-darwin/nix-darwin/master";
    darwin.inputs.nixpkgs.follows = "nixpkgs";
    nix-homebrew.url = "github:zhaofengli/nix-homebrew";
    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";
    determinate.url = "github:DeterminateSystems/determinate";
    comin.url = "github:nlewo/comin/004a55ced41d72340373ebc6774e29a417512638";
    comin.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs = inputs: import ./flake-outputs.nix inputs;
}
