const gui = new dat.GUI();
const stats = new Stats();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
const renderer = new THREE.WebGLRenderer({ antialias: true });
const controls = new THREE.OrbitControls(camera, renderer.domElement);
const textureLoader = new THREE.TextureLoader();

scene.background = new THREE.Color(0xbbbbbb);
camera.position.set(0, 0.5, 3);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
controls.enableDamping = true;

document.body.style.margin = 0;
document.body.appendChild(stats.domElement);
document.body.appendChild(renderer.domElement);

const flagVertex = `
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform vec2 uFrequency;
uniform float uTime;
uniform float uStrength;

attribute vec3 position;
attribute vec2 uv;

varying float vDark;
varying vec2 vUv;


void main() {
    vec4 modelPosition = modelMatrix * vec4(position, 1.0);

    float xFactor = clamp((modelPosition.x + 1.25) / 2.0, 0.0, 2.0); 

    float vWave = sin(modelPosition.x * uFrequency.x - uTime ) * xFactor * uStrength ;
    vWave += sin(modelPosition.y * uFrequency.y - uTime) * xFactor * uStrength * 0.5;
    
    modelPosition.x += sin(modelPosition.y + 1.575) * 0.5 - 0.25;
    modelPosition.y += sin(modelPosition.x * 2.0 + uTime * 0.5) * 0.05 * xFactor;
    modelPosition.z += vWave;

    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;

    vUv = uv;    
    vDark = vWave;
}
`;

const flagFragment = `
precision mediump float;

varying float vDark;
uniform sampler2D uTexture;
varying vec2 vUv;


void main(){
    vec4 textColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(0.5, 0.5, 0.95, 1.0);
    textColor.rgb *= vDark + 0.85;
    gl_FragColor = textColor;
}`;

const flagGroup = new THREE.Object3D();
scene.add(flagGroup);

const pole = new THREE.Mesh(
  new THREE.CylinderGeometry(0.05, 0.05, 5, 16),
  new THREE.MeshBasicMaterial({ color: 0x333333 })
);
pole.position.y = -1.4;
pole.position.x = -1.5;
flagGroup.add(pole);

const config = {
  animationSpeed: 6,
  wireframe: false,
  segments: 64,
  frequency: {
    x: 5,
    y: 3
  },
  strength: 0.2
};

const createFlag = () => {
  const { wireframe, segments, frequency, strength } = config;
  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2, 0.025, segments, segments),
    new THREE.RawShaderMaterial({
      vertexShader: flagVertex,
      fragmentShader: flagFragment,
      side: THREE.DoubleSide,
      wireframe: wireframe,
      uniforms: {
        uFrequency: { value: new THREE.Vector2(frequency.x, frequency.y) },
        uTime: { value: 0 },
        uTexture: {
          value: textureLoader.load("https://i.imgur.com/fokRJkR.jpg")
        },
        uStrength: { value: strength }
      }
    })
  );
  return flag;
};

let flag = createFlag();
flagGroup.add(flag);

const onConfigChange = () => {
  console.log(config);

  flagGroup.remove(flag);
  flag.geometry.dispose();
  flag.material.dispose();

  flag = createFlag();
  flagGroup.add(flag);
};

gui.add(config, "wireframe").onChange((val) => {
  flag.material.wireframe = val;
  pole.material.wireframe = val;
});
gui.add(config, "segments", 8, 256).onFinishChange(onConfigChange);
gui
  .add(config.frequency, "x", 0, 12)
  .onChange((val) => {
    flag.material.uniforms.uFrequency.value.x = val;
  })
  .name("Frequency x");
gui
  .add(config.frequency, "y", 0, 12)
  .onChange((val) => {
    flag.material.uniforms.uFrequency.value.y = val;
  })
  .name("Frequency y");
gui
  .add(config, "strength", 0.05, 0.3)
  .onChange((val) => {
    flag.material.uniforms.uStrength.value = val;
  })
  .name("Strength");
gui.add(config, "animationSpeed", 0, 20);

const animate = (t) => {
  stats.begin();

  const elapsedTime = t / 1000;
  flag.material.uniforms.uTime.value = elapsedTime * config.animationSpeed;

  controls.update();
  renderer.render(scene, camera);
  stats.end();
  requestAnimationFrame(animate);
};

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener("dblclick", () => {
  const fullscreenElement =
    document.fullscreenElement || document.webkitFullscreenElement;

  if (!fullscreenElement) {
    if (document.body.requestFullscreen) {
      document.body.requestFullscreen();
    } else if (document.body.webkitRequestFullscreen) {
      document.body.webkitRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
});
