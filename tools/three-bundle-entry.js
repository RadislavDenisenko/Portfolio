/* Tree-shaken three surface for docs/assets/hand.js — exactly the symbols the
   hand module imports, nothing else. Rebuilt with esbuild:
     npx esbuild tools/three-bundle-entry.js --bundle --format=esm --minify \
       --legal-comments=inline --outfile=docs/assets/vendor/three-slim.min.js
   Kept in sync by hand: `grep -o "THREE\.[A-Za-z0-9_]*" docs/assets/hand.js`
   must be a subset of this list, and nothing here may be unused.
   Over the previous bundle this adds the shadow-map type, the CustomBlending
   factors (additive RGB without additive alpha, so the overlays glow over the
   room photo instead of fogging it) and Sprite/CanvasTexture for the landmark
   halos' radial falloff; it drops AdditiveBlending and Color, which nothing
   references any more. */
export {
  ACESFilmicToneMapping,
  BufferGeometry,
  CanvasTexture,
  CustomBlending,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  OneFactor,
  PCFShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SrcAlphaFactor,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  ZeroFactor
} from 'three';
