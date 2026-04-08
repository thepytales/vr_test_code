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
        this.originalPos = null;
        this.originalRotY = 0; // Speichert die Drehung

        // --- NEU: Globale Joystick-Daten direkt am Controller auslesen ---
        this.el.addEventListener('axismove', (evt) => {
            let axes = evt.detail.axis;
            if (!axes || axes.length < 2) return;
            
            if (this.el.id === 'left-controller') {
                window.moveY = Math.abs(axes[1]) > 0.1 ? axes[1] : 0;
            } else if (this.el.id === 'right-controller') {
                window.turnX = Math.abs(axes[0]) > 0.1 ? axes[0] : 0;
            }
        });

        this.el.addEventListener('thumbstickmoved', (evt) => {
            if (this.el.id === 'left-controller') {
                window.moveY = Math.abs(evt.detail.y) > 0.1 ? evt.detail.y : 0;
            } else if (this.el.id === 'right-controller') {
                window.turnX = Math.abs(evt.detail.x) > 0.1 ? evt.detail.x : 0;
            }
        });
        
        const grabStart = () => {
            let raycaster = this.el.components.raycaster;
            if (!raycaster || !raycaster.intersectedEls || raycaster.intersectedEls.length === 0) return;
            
            let firstEl = raycaster.intersectedEls[0];
            
            let clickableEl = firstEl.closest('.clickable');
            if (clickableEl && clickableEl.id === 'ok-button') {
                document.getElementById('start-menu').setAttribute('visible', 'false');
                clickableEl.classList.remove('clickable');
                return;
            }

            if (window.isWheelchairMode) return; 
            
            let movableEl = firstEl.closest('.movable');
            if (movableEl) {
                this.grabbedEl = movableEl;
                
                // Position und Rotation via object3D sichern!
                this.originalPos = { 
                    x: movableEl.object3D.position.x, 
                    y: movableEl.object3D.position.y, 
                    z: movableEl.object3D.position.z 
                };
                this.originalRotY = movableEl.object3D.rotation.y;
                
                this.el.object3D.attach(this.grabbedEl.object3D);
            }
        };

        const grabEnd = () => {
            if (this.grabbedEl) {
                this.el.sceneEl.object3D.attach(this.grabbedEl.object3D);
                
                // 1. Zwangsbegradigung: Kippen (X und Z) auf 0 setzen!
                let currentRot = this.grabbedEl.object3D.rotation;
                this.grabbedEl.object3D.rotation.set(0, currentRot.y, 0);

                // 2. Schweben verhindern: Y-Position strikt auf 0 setzen!
                let currentPos = this.grabbedEl.object3D.position;
                this.grabbedEl.object3D.position.set(currentPos.x, 0, currentPos.z);
                
                let isChair = this.grabbedEl.innerHTML.indexOf('height="0.45"') > -1;
                // STARK REDUZIERTE RADIEN für viel mehr Toleranz beim Abstellen
                let myRadius = isChair ? 0.2 : 0.45; 
                
                let hasCollision = false;
                let collidables = document.querySelectorAll('.collidable');
                
                for (let i = 0; i < collidables.length; i++) {
                    let otherEl = collidables[i];
                    if (otherEl === this.grabbedEl) continue;
                    
                    let otherPos = otherEl.object3D.position;
                    let dx = currentPos.x - otherPos.x;
                    let dz = currentPos.z - otherPos.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let otherIsChair = otherEl.innerHTML.indexOf('height="0.45"') > -1;
                    let otherRadius = otherIsChair ? 0.2 : 0.45;
                    
                    if (distance < (myRadius + otherRadius)) {
                        hasCollision = true;
                        break;
                    }
                }
                
                // Zurücksetzen nur bei absolut offensichtlicher Kollision (ineinanderstellen)
                if (hasCollision && this.originalPos) {
                    this.grabbedEl.object3D.position.set(this.originalPos.x, 0, this.originalPos.z);
                    this.grabbedEl.object3D.rotation.set(0, this.originalRotY, 0);
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
        this.isTurning = false;
        window.moveY = 0;
        window.turnX = 0;
    },
    tick: function () {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        
        let currentTurnX = window.turnX || 0;
        let currentMoveY = window.moveY || 0;
        
        // --- 1. ROTATION (Rechter Stick) via SNAP-TURN ---
        if (Math.abs(currentTurnX) > 0.6) {
            if (!this.isTurning) {
                let direction = currentTurnX > 0 ? 1 : -1;
                rig.object3D.rotation.y -= direction * (Math.PI / 4);
                this.isTurning = true;
            }
        } else if (Math.abs(currentTurnX) < 0.2) {
            this.isTurning = false;
        }

        // --- 2. FORTBEWEGUNG (Linker Stick) ---
        if (Math.abs(currentMoveY) > 0.25) {
            let direction = new THREE.Vector3();
            camera.object3D.getWorldDirection(direction);
            direction.y = 0; 
            direction.normalize();
            
            let speed = window.isWheelchairMode ? 0.03 : 0.05;
            // MINUS ENTFERNT: Jetzt stimmt die Joycon Richtung wieder
            let multiplier = currentMoveY * speed; 
            
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