{
  description = "Jaipur live-play development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ bun git jdk ];
          shellHook = ''
            # Keep downloaded browser and Firebase artifacts stable across
            # separate `nix develop --command` invocations in CI.
            export XDG_CACHE_HOME="$PWD/.firebase/cache"
          '';
        };
      });
}
