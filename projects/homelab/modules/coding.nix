{ pkgs, ... }:
{
  # Permanent host tools live here. The user's mutable shell/settings files are
  # owned by chezmoi's coding profile in 0x63616c/dotfiles; see docs/coding.md.
  # Git, curl and jq are already supplied by base.nix; do not install duplicates
  # through Homebrew or a user nix profile. Project runtimes belong in dev shells.
  environment.systemPackages = with pkgs; [
    zsh
    chezmoi
    gh
    ripgrep
    starship
    zsh-autosuggestions
    zsh-syntax-highlighting
    (import ../packages/claude-code.nix { inherit pkgs; })
  ];
  # nix-darwin does not link arbitrary share directories into the system profile.
  environment.pathsToLink = [
    "/share/zsh-autosuggestions"
    "/share/zsh-syntax-highlighting"
  ];
  environment.shells = [ pkgs.zsh ];
  users.users.coding.shell = pkgs.zsh;
}
