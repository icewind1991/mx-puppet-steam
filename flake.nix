{
  inputs = {
    utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "nixpkgs/release-23.05";
  };

  outputs = {
    self,
    nixpkgs,
    utils,
  }:
    utils.lib.eachDefaultSystem (system: let
      overlays = [];
      pkgs = (import nixpkgs) {
        inherit system overlays;
      };
      nodejs = pkgs.nodejs_18;
    in rec {
      # `nix develop`
      devShell = pkgs.mkShell {
        nativeBuildInputs = with pkgs; [
          nodejs
          nodejs.pkgs.node-pre-gyp
          nodejs.pkgs.node-gyp-build
          pkg-config
          which
          nodePackages.typescript
          python3
          nodePackages.patch-package
        ];
        buildInputs = with pkgs; [libjpeg pixman cairo pango postgresql];
      };
    });
}
