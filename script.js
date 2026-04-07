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

// Komponente für Controller-Interaktion (Greifen und Buttons)
AFRAME.registerComponent('vr-controller', {
    init: function () {
        this.grabbedEl = null;
        
        // Funktion zum Greifen (wird für Trigger und Grip-Button genutzt)
        const grabStart = () => {
            if (window.isWheelchairMode) return; // Greifen im Rollstuhl deaktiviert
            
            let raycaster = this.el.components.raycaster;
            if (!raycaster || !raycaster.intersectedEls || raycaster.intersectedEls.length === 0) return;
            
            let firstEl = raycaster.intersectedEls[0];
            // Suche das nächste Eltern-Element mit der Klasse 'movable', 
            // da der Laser oft die geometrischen Kinder (z.B. Tischbeine) trifft
            let movableEl = firstEl.closest('.movable');
            
            if (movableEl) {
                this.grabbedEl = movableEl;
                // Hängt das Objekt an den Controller an
                this.el.object3D.attach(this.grabbedEl.object3D);
            }
        };

        // Funktion zum Loslassen
        const grabEnd = () => {
            if (this.grabbedEl) {
                // Hängt das Objekt wieder an die Welt-Szene an
                this.el.sceneEl.object3D.attach(this.grabbedEl.object3D);
                
                // Setze die Y-Achse hart auf 0, damit nichts schwebt
                let currentPos = this.grabbedEl.getAttribute('position');
                this.grabbedEl.setAttribute('position', {x: currentPos.x, y: 0, z: currentPos.z});
                
                this.grabbedEl = null;
            }
        };

        // Event-Listener für Quest 3 Controller (Zeigefinger & Mittelfinger)
        this.el.addEventListener('triggerdown', grabStart);
        this.el.addEventListener('squeezedown', grabStart);
        this.el.addEventListener('triggerup', grabEnd);
        this.el.addEventListener('squeezeup', grabEnd);

        // Modus wechseln via A- oder X-Button
        this.el.addEventListener('xbuttondown', toggleMode);
        this.el.addEventListener('abuttondown', toggleMode);
    }
});

// Komponente für Joycon-Bewegung in BEIDEN Modi mit dynamischer Kollisionserkennung
AFRAME.registerComponent('joystick-movement', {
    init: function () {
        this.axis = [0, 0, 0, 0];
        
        // Lauscht auf Thumbstick-Eingaben beider Controller
        window.addEventListener('axismove', (evt) => {
            if (evt.detail.axis.length >= 2) {
                this.axis[0] = evt.detail.axis[0];
                this.axis[1] = evt.detail.axis[1];
            }
        });
    },
    tick: function (time, timeDelta) {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        let x = this.axis[0]; // Links / Rechts Drehung
        let y = this.axis[1]; // Vorwärts / Rückwärts
        
        // Drehung (Im Stehen schneller drehen als im Rollstuhl)
        if (Math.abs(x) > 0.1) {
            let rotationSpeed = window.isWheelchairMode ? (0.05 * timeDelta) : (0.08 * timeDelta);
            rig.object3D.rotation.y -= x * rotationSpeed;
        }

        // Vorwärts / Rückwärts Bewegung mit Kollisionsprüfung
        if (Math.abs(y) > 0.1) {
            let angle = camera.getAttribute('rotation').y;
            let rad = angle * Math.PI / 180;
            // Im Stehen sind wir schneller unterwegs
            let speed = window.isWheelchairMode ? (0.003 * timeDelta) : (0.006 * timeDelta);
            
            // Berechne die angestrebte nächste Position
            let nextX = rig.object3D.position.x - Math.sin(rad) * y * speed;
            let nextZ = rig.object3D.position.z - Math.cos(rad) * y * speed;
            let canMove = true;

            // 1. Raumgrenzen prüfen (Abstand zur Wand je nach Modus)
            let wallMargin = window.isWheelchairMode ? 5.5 : 5.8;
            if (nextX < -wallMargin || nextX > wallMargin || nextZ < -wallMargin || nextZ > wallMargin) {
                canMove = false;
            }

            // 2. Hindernisse prüfen (Möbel)
            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    
                    // Berechne Distanz auf der horizontalen XZ-Ebene
                    let dx = nextX - el.object3D.position.x;
                    let dz = nextZ - el.object3D.position.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    let isChair = el.innerHTML.indexOf('height="0.45"') > -1;
                    let collisionRadius = 0;

                    // Hitbox-Größen basierend auf Modus (Fußgänger kommen näher an Objekte heran)
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
            
            // Bewegung nur anwenden, wenn der Weg frei ist
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