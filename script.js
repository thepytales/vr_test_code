window.isWheelchairMode = false;

// Funktion zum Wechseln zwischen Einrichtungs- und Rollstuhl-Modus
function toggleMode() {
    window.isWheelchairMode = !window.isWheelchairMode;
    let rig = document.getElementById('player-rig');
    let wheelchairMesh = document.getElementById('wheelchair-mesh');
    let controllers = document.querySelectorAll('[vr-controller]');
    let warningText = document.getElementById('warning-text');
    
    if (window.isWheelchairMode) {
        // Möbel loslassen, falls gerade etwas gegriffen wird
        controllers.forEach(c => {
            let controllerComponent = c.components['vr-controller'];
            if (controllerComponent && controllerComponent.grabbedEl) {
                c.sceneEl.object3D.attach(controllerComponent.grabbedEl.object3D);
                controllerComponent.grabbedEl = null;
            }
        });
        
        // Rig absenken (simuliert Sitzhöhe von ca. 1.10m, wenn normale Höhe 1.60m ist)
        rig.setAttribute('position', {
            x: rig.object3D.position.x, 
            y: -0.5, 
            z: rig.object3D.position.z
        });
        wheelchairMesh.setAttribute('visible', 'true');
    } else {
        // Rig wieder auf normale Stehhöhe setzen
        rig.setAttribute('position', {
            x: rig.object3D.position.x, 
            y: 0, 
            z: rig.object3D.position.z
        });
        wheelchairMesh.setAttribute('visible', 'false');
        warningText.setAttribute('visible', 'false');
    }
}

// Komponente für Controller-Interaktion (Greifen, UI und Buttons)
AFRAME.registerComponent('vr-controller', {
    init: function () {
        this.grabbedEl = null;
        
        const grabStart = () => {
            let raycaster = this.el.components.raycaster;
            if (!raycaster || !raycaster.intersectedEls || raycaster.intersectedEls.length === 0) return;
            
            let firstEl = raycaster.intersectedEls[0];
            
            // 1. Prüfe auf UI Buttons (Start-Menü schließen)
            let clickableEl = firstEl.closest('.clickable');
            if (clickableEl && clickableEl.id === 'ok-button') {
                document.getElementById('start-menu').setAttribute('visible', 'false');
                clickableEl.classList.remove('clickable'); // Verhindert unsichtbare Kollisionen
                return;
            }

            // 2. Prüfe auf Möbelstücke
            if (window.isWheelchairMode) return; // Greifen im Rollstuhl deaktiviert
            
            let movableEl = firstEl.closest('.movable');
            if (movableEl) {
                this.grabbedEl = movableEl;
                this.el.object3D.attach(this.grabbedEl.object3D);
            }
        };

        const grabEnd = () => {
            if (this.grabbedEl) {
                this.el.sceneEl.object3D.attach(this.grabbedEl.object3D);
                let currentPos = this.grabbedEl.getAttribute('position');
                this.grabbedEl.setAttribute('position', {x: currentPos.x, y: 0, z: currentPos.z});
                this.grabbedEl = null;
            }
        };

        this.el.addEventListener('triggerdown', grabStart);
        this.el.addEventListener('squeezedown', grabStart);
        this.el.addEventListener('triggerup', grabEnd);
        this.el.addEventListener('squeezeup', grabEnd);

        this.el.addEventListener('xbuttondown', toggleMode);
        this.el.addEventListener('abuttondown', toggleMode);
    }
});

// Komponente für Joycon-Bewegung in BEIDEN Modi mit dynamischer Kollisionserkennung
AFRAME.registerComponent('joystick-movement', {
    init: function () {
        this.axis = [0, 0];
        
        // Oculus/Meta Controller nutzen 'thumbstickmoved' auf der Entität selbst
        let addThumbstickListener = (controllerId) => {
            let controller = document.getElementById(controllerId);
            if (controller) {
                controller.addEventListener('thumbstickmoved', (evt) => {
                    this.axis[0] = evt.detail.x;
                    this.axis[1] = evt.detail.y;
                });
            }
        };
        
        addThumbstickListener('left-controller');
        addThumbstickListener('right-controller');
    },
    tick: function (time, timeDelta) {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        let x = this.axis[0]; // Links / Rechts Drehung
        let y = this.axis[1]; // Vorwärts / Rückwärts
        
        if (Math.abs(x) > 0.1) {
            let rotationSpeed = window.isWheelchairMode ? (0.05 * timeDelta) : (0.08 * timeDelta);
            rig.object3D.rotation.y -= x * rotationSpeed;
        }

        if (Math.abs(y) > 0.1) {
            let angle = camera.getAttribute('rotation').y;
            let rad = angle * Math.PI / 180;
            let speed = window.isWheelchairMode ? (0.003 * timeDelta) : (0.006 * timeDelta);
            
            // Pluszeichen verwendet, da y negativ ist, wenn der Stick nach vorne gedrückt wird
            let nextX = rig.object3D.position.x + Math.sin(rad) * y * speed;
            let nextZ = rig.object3D.position.z + Math.cos(rad) * y * speed;
            let canMove = true;

            let wallMargin = window.isWheelchairMode ? 5.5 : 5.8;
            if (nextX < -wallMargin || nextX > wallMargin || nextZ < -wallMargin || nextZ > wallMargin) {
                canMove = false;
            }

            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    
                    let dx = nextX - el.object3D.position.x;
                    let dz = nextZ - el.object3D.position.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let isChair = el.innerHTML.indexOf('height="0.45"') > -1;
                    let collisionRadius = 0;

                    if (window.isWheelchairMode) {
                        collisionRadius = isChair ? 0.6 : 1.1;
                    } else {
                        collisionRadius = isChair ? 0.3 : 0.6; 
                    }

                    if (distance < collisionRadius) {
                        canMove = false;
                        break; 
                    }
                }
            }
            
            if (canMove) {
                rig.object3D.position.x = nextX;
                rig.object3D.position.z = nextZ;
            }
        }
    }
});

// Komponente für die Messung von Abständen zu Hindernissen
AFRAME.registerComponent('proximity-sensor', {
    tick: function () {
        if (!window.isWheelchairMode) return;
        
        let camera = document.getElementById('player-camera');
        let movables = document.querySelectorAll('.movable');
        let tooClose = false;

        // Iteriere durch alle Möbelstücke und messe die Distanz zur Kamera (Rollstuhl)
        movables.forEach((el) => {
            let distance = camera.object3D.position.distanceTo(el.object3D.position);
            // Wenn ein Objekt näher als 1.0 Meter zum Zentrum des Rollstuhls ist
            if (distance < 1.0) {
                tooClose = true;
            }
        });

        let warning = document.getElementById('warning-text');
        if (tooClose) {
            warning.setAttribute('visible', 'true');
        } else {
            warning.setAttribute('visible', 'false');
        }
    }
});