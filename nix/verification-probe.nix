{ writeShellApplication, coreutils }:
writeShellApplication {
  name = "tokate-nix-probe";
  runtimeInputs = [ coreutils ];
  text = ''
    test -f result.txt
    exec 3<>/dev/tcp/127.0.0.1/"$1"
    printf nix-closure-verified
  '';
}
