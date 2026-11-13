#!/usr/bin/env bash
# Scaffold a photoreal three.js interior from the template + the library code of the sibling skills.
#   bash <this skill's folder>/scripts/new-project.sh <target-dir>   (personal skills dir or the installed plugin)
# No bundler, no npm install: three and three-mesh-bvh come from jsdelivr (import map / bake worker imports).
# Serve with any static server, e.g. python3 -m http.server 5430 --bind 127.0.0.1 (inside <target-dir>).
set -euo pipefail
T="${1:?usage: new-project.sh <target-dir>}"
S="$(cd "$(dirname "$0")/../.." && pwd)"          # the folder holding all the sibling skills
if [ -e "$T" ] && [ -n "$(ls -A "$T" 2>/dev/null)" ]; then echo "target $T exists and is not empty" >&2; exit 1; fi
mkdir -p "$T"
cp -r "$S/threejs-photoreal-interior/template/." "$T/"
L="$T/src/lib"; mkdir -p "$L"/{gi,post,props,textures,cloth,vegetation,pothos,sky,film}
cp "$S/threejs-baked-gi/scripts/"{gi.js,baker.js,worker.js} "$L/gi/"
cp "$S/threejs-realtime-post/scripts/post.js" "$L/post/"
cp "$S/threejs-lived-in-props/scripts/props.js" "$L/props/"
cp "$S/threejs-procedural-textures/scripts/"*.js "$L/textures/"
cp "$S/threejs-procedural-cloth/scripts/"*.js "$L/cloth/"
cp "$S/threejs-procedural-vegetation/scripts/"*.js "$L/vegetation/" 2>/dev/null || true
cp "$S/threejs-procedural-pothos/scripts/"*.js "$L/pothos/" 2>/dev/null || true
cp "$S/threejs-sky-backdrop/scripts/"*.js "$L/sky/" 2>/dev/null || true
cp "$S/webgl-deterministic-recording/scripts/film/accum.js" "$L/film/" 2>/dev/null || true
cat > "$L/textures/index.js" <<'JS'
export * from './tex.js';
export * from './surfaces.js';
export * from './textiles.js';
export * from './wear.js';
export * from './print.js';
JS
# record where every library file came from (MIT, room-at-dawn) next to the code
cat > "$L/README.md" <<MD
Library code copied from the Claude Code skills in $S on $(date +%F).
Most of it is adapted from room-at-dawn (MIT, github.com/Leonxlnx/room-at-dawn); see the header of each file.
gi/ threejs-baked-gi · post/ threejs-realtime-post · props/ threejs-lived-in-props · textures/ threejs-procedural-textures
cloth/ threejs-procedural-cloth · vegetation/ threejs-procedural-vegetation · pothos/ threejs-procedural-pothos · sky/ threejs-sky-backdrop · film/ webgl-deterministic-recording
MD
echo "created $T"
echo "next: cd $T && python3 -m http.server 5430 --bind 127.0.0.1   then open http://127.0.0.1:5430/?bake=128"
