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

// Komponente für Controller-Interaktion (Greifen, UI, Buttons und Möbel-Kollision)
AFRAME.registerComponent('vr-controller', {
    init: function () {
        this.grabbedEl = null;
        this.originalPos = null; // Speichert den Ort vor dem Greifen
        
        const grabStart = () => {
            let raycaster = this.el.components.raycaster;
            if (!raycaster || !raycaster.intersectedEls || raycaster.intersectedEls.length === 0) return;
            
            let firstEl = raycaster.intersectedEls[0];
            
            // 1. UI Buttons
            let clickableEl = firstEl.closest('.clickable');
            if (clickableEl && clickableEl.id === 'ok-button') {
                document.getElementById('start-menu').setAttribute('visible', 'false');
                clickableEl.classList.remove('clickable');
                return;
            }

            // 2. Möbelstücke
            if (window.isWheelchairMode) return; 
            
            let movableEl = firstEl.closest('.movable');
            if (movableEl) {
                this.grabbedEl = movableEl;
                // Position sichern, falls der neue Platz blockiert ist
                let pos = movableEl.getAttribute('position');
                this.originalPos = { x: pos.x, y: pos.y, z: pos.z };
                
                this.el.object3D.attach(this.grabbedEl.object3D);
            }
        };

        const grabEnd = () => {
            if (this.grabbedEl) {
                this.el.sceneEl.object3D.attach(this.grabbedEl.object3D);
                
                let currentPos = this.grabbedEl.getAttribute('position');
                let isChair = this.grabbedEl.innerHTML.indexOf('height="0.45"') > -1;
                let myRadius = isChair ? 0.4 : 0.8; 
                
                let hasCollision = false;
                let collidables = document.querySelectorAll('.collidable');
                
                // Prüfe Abstand zu ALLEN anderen Möbelstücken
                for (let i = 0; i < collidables.length; i++) {
                    let otherEl = collidables[i];
                    if (otherEl === this.grabbedEl) continue; // Sich selbst ignorieren
                    
                    let otherPos = otherEl.getAttribute('position');
                    let dx = currentPos.x - otherPos.x;
                    let dz = currentPos.z - otherPos.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let otherIsChair = otherEl.innerHTML.indexOf('height="0.45"') > -1;
                    let otherRadius = otherIsChair ? 0.4 : 0.8;
                    
                    // Wenn die Radien sich überschneiden -> Kollision!
                    if (distance < (myRadius + otherRadius)) {
                        hasCollision = true;
                        break;
                    }
                }
                
                if (hasCollision && this.originalPos) {
                    // Platz besetzt -> Snappe zurück zum Start
                    this.grabbedEl.setAttribute('position', { x: this.originalPos.x, y: 0, z: this.originalPos.z });
                } else {
                    // Platz frei -> Auf den Boden stellen
                    this.grabbedEl.setAttribute('position', { x: currentPos.x, y: 0, z: currentPos.z });
                }
                
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
        this.moveY = 0;
        this.turnX = 0;
        this.isTurning = false;
    },
    // play() wird ausgeführt, wenn das Element und seine Kinder im DOM bereit sind
    play: function () {
        let leftCtrl = document.getElementById('left-controller');
        let rightCtrl = document.getElementById('right-controller');

        if (leftCtrl) {
            leftCtrl.addEventListener('thumbstickmoved', (evt) => {
                this.moveY = evt.detail.y;
            });
        }
        if (rightCtrl) {
            rightCtrl.addEventListener('thumbstickmoved', (evt) => {
                this.turnX = evt.detail.x;
            });
        }
    },
    tick: function () {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        
        // --- 1. ROTATION (Rechter Stick) via SNAP-TURN ---
        if (Math.abs(this.turnX) > 0.6) {
            if (!this.isTurning) {
                let direction = this.turnX > 0 ? 1 : -1;
                rig.object3D.rotation.y -= direction * (Math.PI / 4); // 45 Grad Drehung
                this.isTurning = true;
            }
        } else if (Math.abs(this.turnX) < 0.2) {
            this.isTurning = false;
        }

        // --- 2. FORTBEWEGUNG (Linker Stick) ---
        if (Math.abs(this.moveY) > 0.25) {
            let direction = new THREE.Vector3();
            // Holt den Vektor, in den das Headset schaut
            camera.object3D.getWorldDirection(direction);
            direction.y = 0; 
            direction.normalize();
            
            let speed = window.isWheelchairMode ? 0.03 : 0.05;
            // Wenn man den Stick nach vorne drückt, ist moveY negativ (z.B. -1).
            // Wir multiplizieren mit -this.moveY, um einen positiven Multiplikator für die Richtung zu erhalten.
            let multiplier = -this.moveY * speed; 
            
            let nextX = rig.object3D.position.x + (direction.x * multiplier);
            let nextZ = rig.object3D.position.z + (direction.z * multiplier);
            let canMove = true;

            // Wand-Kollision
            let wallMargin = window.isWheelchairMode ? 5.5 : 5.8;
            if (nextX < -wallMargin || nextX > wallMargin || nextZ < -wallMargin || nextZ > wallMargin) {
                canMove = false;
            }

            // Möbel-Kollision für den Spieler
            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    
                    let dx = nextX - el.object3D.position.x;
                    let dz = nextZ - el.object3D.position.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let isChair = el.innerHTML.indexOf('height="0.45"') > -1;
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