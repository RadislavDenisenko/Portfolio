/* Tree-shaken three surface for docs/assets/hand.js — exactly the symbols the
   hand module imports, nothing else. Rebuilt with esbuild:
     npx esbuild entry.js --bundle --format=esm --minify --legal-comments=inline
   Adds (over the previous bundle) the texture + PMREM surface needed for the
   PBR skin maps and the room environment map. */
export {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
