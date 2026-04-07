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
        
        // Möbel greifen
        this.el.addEventListener('triggerdown', () => {
            if (window.isWheelchairMode) return; // Greifen im Rollstuhl deaktiviert
            
            let raycaster = this.el.components.raycaster;
            if (!raycaster) return;
            
            let intersectedEls = raycaster.intersectedEls;
            if (intersectedEls.length > 0) {
                let firstEl = intersectedEls[0];
                if (firstEl.classList.contains('movable')) {
                    this.grabbedEl = firstEl;
                    // Hängt das Objekt an den Controller an (Three.js attach erhält die Weltposition)
                    this.el.object3D.attach(this.grabbedEl.object3D);
                }
            }
        });
        
        // Möbel loslassen
        this.el.addEventListener('triggerup', () => {
            if (this.grabbedEl) {
                // Hängt das Objekt wieder an die Szene an
                this.el.sceneEl.object3D.attach(this.grabbedEl.object3D);
                
                // Stelle sicher, dass die Objekte nicht durch den Boden fallen oder schweben
                let currentPos = this.grabbedEl.getAttribute('position');
                this.grabbedEl.setAttribute('position', {x: currentPos.x, y: 0, z: currentPos.z});
                
                this.grabbedEl = null;
            }
        });

        // Modus wechseln via A- oder X-Button an den Quest-Controllern
        this.el.addEventListener('xbuttondown', toggleMode);
        this.el.addEventListener('abuttondown', toggleMode);
    }
});

// Komponente für Joycon-Bewegung im Rollstuhl-Modus mit Kollisionserkennung
AFRAME.registerComponent('joystick-movement', {
    init: function () {
        this.axis = [0, 0, 0, 0];
        
        // Lauscht auf Thumbstick-Eingaben beider Controller
        window.addEventListener('axismove', (evt) => {
            if (!window.isWheelchairMode) return;
            if (evt.detail.axis.length >= 2) {
                this.axis[0] = evt.detail.axis[0];
                this.axis[1] = evt.detail.axis[1];
            }
        });
    },
    tick: function (time, timeDelta) {
        if (!window.isWheelchairMode) return;
        
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        let x = this.axis[0]; // Links / Rechts Drehung
        let y = this.axis[1]; // Vorwärts / Rückwärts
        
        // Drehung (separat berechnet, da Drehen am Platz im Rollstuhl meist erlaubt ist)
        if (Math.abs(x) > 0.1) {
            let rotationSpeed = 0.05 * timeDelta;
            rig.object3D.rotation.y -= x * rotationSpeed;
        }

        // Vorwärts / Rückwärts Bewegung mit Kollisionsprüfung
        if (Math.abs(y) > 0.1) {
            let angle = camera.getAttribute('rotation').y;
            let rad = angle * Math.PI / 180;
            let speed = 0.003 * timeDelta;
            
            // Berechne die angestrebte nächste Position
            let nextX = rig.object3D.position.x - Math.sin(rad) * y * speed;
            let nextZ = rig.object3D.position.z - Math.cos(rad) * y * speed;
            let canMove = true;

            // 1. Raumgrenzen prüfen (Raum ist 12x12 Meter groß, Zentrum ist 0,0)
            // Rollstuhl hat einen Radius, daher halten wir 0.5m Abstand zur Wand (-5.5 bis 5.5)
            if (nextX < -5.5 || nextX > 5.5 || nextZ < -5.5 || nextZ > 5.5) {
                canMove = false;
            }

            // 2. Hindernisse prüfen (Möbel)
            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    
                    // Berechne Distanz auf der horizontalen XZ-Ebene (Y-Achse ignorieren)
                    let dx = nextX - el.object3D.position.x;
                    let dz = nextZ - el.object3D.position.z;
                    let distance = Math.sqrt(dx * dx + dz * dz);
                    
                    // Definiere den Kollisionsradius basierend auf dem Objekt
                    // Tische und Lehrerpult brauchen einen größeren Radius als Stühle
                    let isChair = el.innerHTML.indexOf('height="0.45"') > -1; // Einfacher Check für Stühle
                    let collisionRadius = isChair ? 0.6 : 1.1;

                    if (distance < collisionRadius) {
                        canMove = false;
                        break; // Schleife abbrechen, da eine Kollision reicht
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