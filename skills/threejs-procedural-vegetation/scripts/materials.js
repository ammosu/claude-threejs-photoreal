// Bark and leaf materials with hierarchical wind in the vertex shader (pure function of uTime: any time can be
// rendered, e.g. for motion blur or a deterministic film), plus matching depth materials so shadows sway too.
// Adapted from room-at-dawn (MIT) src/scene/parts/exterior.js. The original lit leaves from its per-vertex light
// bake (sky visibility, light through the blade); here they use ordinary three.js lights: a sun DirectionalLight
// (+ HemisphereLight) and a per-card openness attribute (aOpen) standing in for sky visibility.
import * as THREE from 'three';

/** Shared uniforms: advance U.uTime.value every frame (seconds). */
export const U = {
  uTime: { value: 0 },
  uWindDir: { value: new THREE.Vector2(0.955, -0.296) },   // xz, unit
  uWind: { value: 1 },                                     // strength multiplier (0 = still)
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },   // world, towards the sun
  uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
  uSkyZen: { value: new THREE.Color(0.3, 0.47, 0.92) },
  uSkyHor: { value: new THREE.Color(0.8, 0.95, 1.2) },
};

// Hierarchical wind. aW1 = limb pivot xyz + length, aW2 = branch pivot xyz + length (0 = none),
// aW3 = trunk base x, z, tree height, ground y. A twig's vertices and the leaves on it share them, so they move together.
const WIND_GLSL = /* glsl */`
uniform float uTime; uniform vec2 uWindDir; uniform float uWind;
attribute vec4 aW1; attribute vec4 aW2; attribute vec4 aW3;
float wHash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }
// gust strength 0..1: low-frequency noise over world xz that drifts downwind
float wGust(vec2 xz){
	vec2 q = xz * 0.05 - uWindDir * (uTime * 0.23);
	return smoothstep(0.25, 0.8, wNoise(q) * 0.6 + wNoise(q * 2.6 + 17.3) * 0.4);
}
// one level of the hierarchy: bend about a pivot, growing along the branch
vec3 wSway(vec4 piv, vec3 p, float amp, float rate){
	float w = min(distance(p, piv.xyz) / piv.w, 1.35); w *= sqrt(w);
	float ph = wHash(piv.xz * 3.7 + piv.y) * 6.2832, k = 0.75 + 0.5 * wHash(piv.zy * 5.1 + piv.x);
	float g = wGust(piv.xz), t = uTime * rate * k;
	float s1 = sin(t + ph) + 0.35 * sin(t * 2.13 + ph * 1.7), s2 = cos(t * 0.87 + ph * 2.3), s3 = sin(t * 1.31 + ph * 0.6);
	vec3 wd = vec3(uWindDir.x, 0.0, uWindDir.y), sd = vec3(-uWindDir.y, 0.0, uWindDir.x);
	return (piv.w * w * amp) * ((0.25 + g) * (wd * (0.8 + 0.45 * s1) + sd * (0.4 * s2)) + vec3(0.0, (0.1 + 0.3 * g) * s3 - 0.25 * g, 0.0));
}
vec3 windOffset(vec3 p){
	float hh = clamp((p.y - aW3.w) / aW3.z, 0.0, 1.2); hh *= hh;      // crown lean grows with height
	float ph = wHash(aW3.xy * 0.37) * 6.2832;
	vec3 d = vec3(uWindDir.x, 0.0, uWindDir.y) * (hh * (0.012 + 0.05 * wGust(aW3.xy) + 0.014 * sin(uTime * 0.8 + ph) + 0.007 * sin(uTime * 1.43 + ph * 2.1)));
	if (aW1.w > 0.0) d += wSway(aW1, p, 0.008, 2.1);
	if (aW2.w > 0.0) d += wSway(aW2, p, 0.018, 4.3);
	return d * uWind;
}`;
const WIND_PROJECT = /* glsl */`
	vec4 mvPosition = modelMatrix * vec4( transformed, 1.0 );
	mvPosition.xyz += windOffset( mvPosition.xyz );
	mvPosition = viewMatrix * mvPosition;
	gl_Position = projectionMatrix * mvPosition;`;

const bindU = (sh) => Object.assign(sh.uniforms, U);

function barkVertex(sh) {
  bindU(sh);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL).replace('#include <project_vertex>', WIND_PROJECT);
}

/** Bark: tubes from Bark.geo(). maps from barkMaps(). */
export function barkMaterial({ map, normalMap }) {
  const m = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95 });
  m.onBeforeCompile = (sh) => {
    barkVertex(sh);
    // round form under a diffuse sky: lighter on top, darker underneath, so twigs read as structure in the gaps
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', /* glsl */`
	{ vec3 bN = inverseTransformDirection( normal, viewMatrix ); outgoingLight *= mix( 0.7, 1.22, smoothstep( -0.7, 0.8, bN.y ) ); }
	#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'veg-bark';
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.onBeforeCompile = barkVertex; d.customProgramCacheKey = () => 'veg-bark-depth';
  return { material: m, depth: d };
}

// Leaf card vertex code: atlas tile lookup (mirrored on half the cards), flutter (twist + nod about the stem),
// rigid ride on the branch the leaf grows from. aLeaf = tile u0, v0, phase, flutter amount.
const LEAF_DECL = WIND_GLSL + '\nattribute vec4 aLeaf; attribute float aOpen; varying float vOpen;\n';
const LEAF_UV = /* glsl */`#include <uv_vertex>
	vMapUv = aLeaf.xy + vec2( mix( uv.x, 1.0 - uv.x, step( 0.5, fract( aLeaf.z * 17.0 ) ) ), 1.0 - uv.y ) * 0.25;
	#ifdef USE_NORMALMAP
	vNormalMapUv = vMapUv;
	#endif`;
const LEAF_FLUTTER = /* glsl */`
	vec3 lAnchor = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	vec3 lOff = windOffset( lAnchor );
	float lG = wGust( lAnchor.xz ) * 0.75 + 0.45 * wNoise( lAnchor.xz * 0.42 - uWindDir * ( uTime * 1.1 ) );
	float lA = aLeaf.w * ( 0.14 + 0.86 * lG ) * uWind, lP = aLeaf.z * 6.2832;
	float lTw = lA * ( 0.17 * sin( uTime * ( 6.5 + 4.0 * aLeaf.z ) + lP ) + 0.08 * sin( uTime * ( 15.0 + 7.0 * aLeaf.z ) + lP * 2.7 ) );
	float lNod = lA * ( 0.13 * sin( uTime * ( 4.2 + 2.6 * aLeaf.z ) + lP * 1.9 ) + 0.05 * sin( uTime * 11.7 + lP * 4.1 ) - 0.08 );
	float lTy = 0.35 + 0.65 * position.y;`;
const LEAF_BEGIN = /* glsl */`
	vec3 transformed = vec3( position );
	transformed.z += position.x * lTw * lTy + position.y * position.y * lNod;
	vOpen = aOpen;`;
const LEAF_PROJECT = /* glsl */`
	vec4 mvPosition = modelMatrix * ( instanceMatrix * vec4( transformed, 1.0 ) );
	mvPosition.xyz += lOff;
	mvPosition = viewMatrix * mvPosition;
	gl_Position = projectionMatrix * mvPosition;`;

/** Leaves: the InstancedMesh from Leaves.build(). atlas from buildAtlas(). Returns { material, depth }. */
export function leafMaterial(atlas, { sheen = 1.3, translucency = 0.6 } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: atlas.map, normalMap: atlas.normalMap, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    bindU(sh); sh.uniforms.uLeafP = { value: atlas.paramMap }; sh.uniforms.uSheen = { value: sheen }; sh.uniforms.uTrans = { value: translucency };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + LEAF_DECL)
      .replace('#include <uv_vertex>', LEAF_UV)
      .replace('#include <beginnormal_vertex>', LEAF_FLUTTER + '\n\tvec3 objectNormal = normalize( vec3( normal.x - lTw * lTy, normal.y - 2.0 * position.y * lNod, normal.z ) );')
      .replace('#include <begin_vertex>', LEAF_BEGIN)
      .replace('#include <project_vertex>', LEAF_PROJECT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLeafP; uniform float uTime, uSheen, uTrans; uniform vec3 uSunDir, uSunCol, uSkyZen, uSkyHor; varying float vOpen;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
	vec4 lPar = texture2D( uLeafP, vMapUv );                                     // r thin blade, g gloss, b random per leaflet
	diffuseColor.rgb *= mix( vec3( 0.92, 0.95, 0.92 ), vec3( 1.3, 1.12, 0.8 ), vOpen );   // inner canopy deeper and cooler, outer sprays lighter, yellower
	// the face that looks at the ground is the leaf's underside: paler, greyer, matte
	float lUnder = smoothstep( 0.25, -0.3, inverseTransformDirection( normalize( vNormal ) * ( gl_FrontFacing ? 1.0 : -1.0 ), viewMatrix ).y );
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb, dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) ) * vec3( 0.86, 1.0, 0.98 ), 0.3 ) * 0.74, lUnder );`)
      .replace('#include <opaque_fragment>', /* glsl */`
{
	vec3 lV = normalize( vViewPosition );
	float lnv = abs( dot( normal, lV ) );
	vec3 lNw = inverseTransformDirection( normal, viewMatrix );
	// crown interior is darker (stands in for sky visibility)
	outgoingLight *= mix( 0.42, 1.05, vOpen );
	// a spray shades itself near its twig; clumps are darker at their heart
	vec2 lUv = fract( vMapUv * 4.0 );
	float lAo = vMapUv.y < 0.75 ? 1.0 - lUv.y : length( lUv - 0.5 ) * 2.2;
	outgoingLight *= mix( 0.7, 1.08, smoothstep( 0.0, 0.75, lAo ) );
	// sun through the blade from its far side: thin young leaflets glow yellow-green, thick ones stay opaque
	float lBack = max( -dot( lNw, uSunDir ), 0.0 );
	vec3 lTc = diffuseColor.rgb * vec3( 1.4, 1.15, 0.4 ) + vec3( 0.01, 0.016, 0.0 );
	outgoingLight += lTc * uSunCol * ( lBack * ( 0.3 + 0.7 * lPar.r * lPar.r ) * uTrans * ( 0.25 + 0.75 * vOpen ) );
	// the waxy upper face mirrors the sky: only glossier leaflets, only where open to the sky
	vec3 lR = inverseTransformDirection( reflect( -lV, normal ), viewMatrix );
	vec3 lSky = mix( uSkyHor, uSkyZen, sqrt( clamp( lR.y, 0.0, 1.0 ) ) );
	lSky = mix( uSkyHor * 0.08, lSky, smoothstep( -0.15, 0.5, lR.y ) );
	lSky = mix( vec3( dot( lSky, vec3( 0.25, 0.6, 0.15 ) ) ), lSky, 0.4 );
	float lGl = lPar.g * mix( 1.0, 0.2, lUnder ) * ( 0.85 + 0.15 * sin( uTime * ( 5.0 + 7.0 * lPar.b ) + lPar.b * 61.0 ) );
	float lF = 0.04 + 0.22 * pow( 1.0 - lnv, 5.0 ) * smoothstep( 0.1, 0.45, abs( dot( nonPerturbedNormal, lV ) ) );   // no glare off a card seen edge-on
	outgoingLight += lSky * ( lF * lGl * vOpen * uSheen * 0.35 );
}
#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'veg-leaf';
  // shadows: same card motion + alpha-tested atlas, so the shadow is leaf-shaped and sways with the leaves
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas.map, alphaTest: 0.5, side: THREE.DoubleSide });
  d.onBeforeCompile = (sh) => {
    bindU(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + LEAF_DECL)
      .replace('#include <uv_vertex>', LEAF_UV.replace(/#ifdef USE_NORMALMAP[\s\S]*?#endif/, ''))
      .replace('#include <begin_vertex>', LEAF_FLUTTER + LEAF_BEGIN)
      .replace('#include <project_vertex>', LEAF_PROJECT);
  };
  d.customProgramCacheKey = () => 'veg-leaf-depth';
  return { material: m, depth: d };
}
