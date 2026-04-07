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
        this.moveAxis = 0; // Für den linken Controller (Bewegung)
        this.turnAxis = 0; // Für den rechten Controller (Drehung)
        
        // Linker Controller = Laufen/Fahren
        let leftController = document.getElementById('left-controller');
        if (leftController) {
            leftController.addEventListener('thumbstickmoved', (evt) => {
                this.moveAxis = evt.detail.y;
            });
        }

        // Rechter Controller = Drehen
        let rightController = document.getElementById('right-controller');
        if (rightController) {
            rightController.addEventListener('thumbstickmoved', (evt) => {
                this.turnAxis = evt.detail.x;
            });
        }
    },
    tick: function (time, timeDelta) {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        
        // Verhindert extreme Sprünge bei Lag / Rucklern im Headset
        if (timeDelta > 50) timeDelta = 50; 
        
        let turnInput = this.turnAxis;
        let moveInput = this.moveAxis;
        
        // 1. Drehung (Rechter Stick)
        if (Math.abs(turnInput) > 0.1) {
            // Drastisch reduzierte Multiplikatoren für eine angenehme Drehung
            let rotationSpeed = window.isWheelchairMode ? (0.001 * timeDelta) : (0.0015 * timeDelta);
            rig.object3D.rotation.y -= turnInput * rotationSpeed;
        }

        // 2. Fortbewegung (Linker Stick)
        if (Math.abs(moveInput) > 0.1) {
            // Holt den exakten Vektor, wohin das Headset in der Welt schaut
            let direction = new THREE.Vector3();
            camera.object3D.getWorldDirection(direction);
            
            // Angemessene Geschwindigkeiten
            let speed = window.isWheelchairMode ? (0.0015 * timeDelta) : (0.0025 * timeDelta);
            
            // Wenn der Stick nach vorne gedrückt wird, ist moveInput negativ (-1).
            // Daher multiplizieren wir mit -moveInput, um in Blickrichtung zu gehen.
            let nextX = rig.object3D.position.x + (direction.x * -moveInput * speed);
            let nextZ = rig.object3D.position.z + (direction.z * -moveInput * speed);
            let canMove = true;

            // Wand-Kollision
            let wallMargin = window.isWheelchairMode ? 5.5 : 5.8;
            if (nextX < -wallMargin || nextX > wallMargin || nextZ < -wallMargin || nextZ > wallMargin) {
                canMove = false;
            }

            // Möbel-Kollision
            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    
                    let dx = nextX - el.object3D.position.x;
                    let dz = nextZ - el.object3D.position.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let isChair = el.innerHTML.indexOf('height="0.45"') > -1;
                    
                    // Im Rollstuhl ist die Hitbox breiter
                    let collisionRadius = window.isWheelchairMode ? (isChair ? 0.6 : 1.1) : (isChair ? 0.3 : 0.6);

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