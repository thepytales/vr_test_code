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
        this.moveY = 0;
        this.turnX = 0;
        this.isTurning = false; // Sperre für den Snap-Turn

        // Lauscht auf axismove direkt am Rig (sammelt alle Controller ein)
        this.el.addEventListener('axismove', (evt) => {
            let targetId = evt.target.id;
            let axes = evt.detail.axis;

            // Achse 0/1 sind der primäre Stick, Achse 2/3 tauchen manchmal je nach Browser-Mapping auf
            if (targetId === 'left-controller') {
                // Linker Controller: Suche den stärksten Y-Ausschlag (Vor/Zurück)
                let yVal = Math.abs(axes[1]) > Math.abs(axes[3] || 0) ? axes[1] : (axes[3] || 0);
                this.moveY = yVal;
            } else if (targetId === 'right-controller') {
                // Rechter Controller: Suche den stärksten X-Ausschlag (Links/Rechts)
                let xVal = Math.abs(axes[0]) > Math.abs(axes[2] || 0) ? axes[0] : (axes[2] || 0);
                this.turnX = xVal;
            }
        });
    },
    tick: function () {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        
        // --- 1. ROTATION (Rechter Stick) via SNAP-TURN ---
        // Snap-Turn macht wildes Kreiseln unmöglich
        if (Math.abs(this.turnX) > 0.6) {
            if (!this.isTurning) {
                // Drehe einmalig hart um 45 Grad (Math.PI / 4)
                let direction = this.turnX > 0 ? 1 : -1;
                rig.object3D.rotation.y -= direction * (Math.PI / 4);
                this.isTurning = true; // Blockieren, bis der Stick losgelassen wird
            }
        } else if (Math.abs(this.turnX) < 0.2) {
            // Hebt die Sperre auf, wenn der Stick wieder nah der Mitte ist
            this.isTurning = false;
        }

        // --- 2. FORTBEWEGUNG (Linker Stick) ---
        // Hohe Deadzone (25%), um versehentliches Bewegen / Stick-Drift komplett auszublenden
        if (Math.abs(this.moveY) > 0.25) {
            let direction = new THREE.Vector3();
            camera.object3D.getWorldDirection(direction);
            direction.y = 0; // Wir bleiben strikt auf dem Boden
            direction.normalize();
            
            // Feste Geschwindigkeits-Werte pro Frame (ignoriert timeDelta komplett)
            let speed = window.isWheelchairMode ? 0.03 : 0.05;
            let moveAmount = this.moveY * -speed; // Negativ, weil nach vorne drücken auf Y oft -1 ergibt
            
            let nextX = rig.object3D.position.x + (direction.x * moveAmount);
            let nextZ = rig.object3D.position.z + (direction.z * moveAmount);
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