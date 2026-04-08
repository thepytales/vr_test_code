window.isWheelchairMode = false;
window.gameStarted = false;

// Funktion zum Wechseln zwischen Einrichtungs- und Rollstuhl-Modus
function toggleMode() {
    window.isWheelchairMode = !window.isWheelchairMode;
    let rig = document.getElementById('player-rig');
    let wheelchairMesh = document.getElementById('wheelchair-mesh');
    let controllers = document.querySelectorAll('[vr-controller]');
    let warningText = document.getElementById('warning-text');
    
    if (window.isWheelchairMode) {
        controllers.forEach(c => {
            let controllerComponent = c.components['vr-controller'];
            if (controllerComponent && controllerComponent.grabbedEl) {
                c.sceneEl.object3D.attach(controllerComponent.grabbedEl.object3D);
                controllerComponent.grabbedEl = null;
            }
        });
        
        rig.setAttribute('position', {
            x: rig.object3D.position.x, 
            y: -0.5, 
            z: rig.object3D.position.z
        });
        wheelchairMesh.setAttribute('visible', 'true');
    } else {
        rig.setAttribute('position', {
            x: rig.object3D.position.x, 
            y: 0, 
            z: rig.object3D.position.z
        });
        wheelchairMesh.setAttribute('visible', 'false');
        warningText.setAttribute('visible', 'false');
    }
}

// Komponente für Controller-Interaktion
AFRAME.registerComponent('vr-controller', {
    init: function () {
        this.grabbedEl = null;
        this.originalPos = null;
        this.originalRotY = 0; 

        this.el.addEventListener('axismove', (evt) => {
            let axes = evt.detail.axis;
            if (!axes || axes.length < 2) return;
            
            if (this.el.id === 'left-controller') {
                window.moveX = Math.abs(axes[0]) > 0.1 ? axes[0] : 0; 
                window.moveY = Math.abs(axes[1]) > 0.1 ? axes[1] : 0; 
            } else if (this.el.id === 'right-controller') {
                window.turnX = Math.abs(axes[0]) > 0.1 ? axes[0] : 0;
            }
        });

        this.el.addEventListener('thumbstickmoved', (evt) => {
            if (this.el.id === 'left-controller') {
                window.moveX = Math.abs(evt.detail.x) > 0.1 ? evt.detail.x : 0;
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
            if (clickableEl && clickableEl.id === 'start-btn-door') {
                document.getElementById('door-hinge').emit('open-door');
                clickableEl.setAttribute('visible', 'false');
                clickableEl.classList.remove('clickable');
                window.gameStarted = true; 

                // Tür-Blockade entfernen
                let doorBlocker = document.getElementById('door-blocker');
                if(doorBlocker) doorBlocker.setAttribute('visible', 'false');
                if(doorBlocker) doorBlocker.classList.remove('collidable');

                // Zufällige Zielzone aktivieren
                let zones = document.querySelectorAll('.target-zone');
                if (zones.length > 0) {
                    zones.forEach(z => z.setAttribute('visible', 'false'));
                    let randomIndex = Math.floor(Math.random() * zones.length);
                    zones[randomIndex].setAttribute('visible', 'true');
                }
                return;
            }

            if (window.isWheelchairMode || !window.gameStarted) return; 
            
            let movableEl = firstEl.closest('.movable');
            if (movableEl) {
                this.grabbedEl = movableEl;
                
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
                
                let currentRot = this.grabbedEl.object3D.rotation;
                this.grabbedEl.object3D.rotation.set(0, currentRot.y, 0);

                let currentPos = this.grabbedEl.object3D.position;
                this.grabbedEl.object3D.position.set(currentPos.x, 0, currentPos.z);
                
                let isChair = this.grabbedEl.innerHTML.indexOf('height="0.45"') > -1;
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

// Komponente für Bewegung (Freigegeben, damit man zur Tür laufen kann)
AFRAME.registerComponent('joystick-movement', {
    init: function () {
        this.isTurning = false;
        window.moveY = 0;
        window.moveX = 0;
        window.turnX = 0;
    },
    tick: function () {
        let rig = this.el;
        let camera = document.getElementById('player-camera');
        
        let currentTurnX = window.turnX || 0;
        let currentMoveY = window.moveY || 0;
        let currentMoveX = window.moveX || 0;
        
        if (Math.abs(currentTurnX) > 0.6) {
            if (!this.isTurning) {
                let direction = currentTurnX > 0 ? 1 : -1;
                rig.object3D.rotation.y -= direction * (Math.PI / 4);
                this.isTurning = true;
            }
        } else if (Math.abs(currentTurnX) < 0.2) {
            this.isTurning = false;
        }

        if (Math.abs(currentMoveY) > 0.25 || Math.abs(currentMoveX) > 0.25) {
            let direction = new THREE.Vector3();
            camera.object3D.getWorldDirection(direction);
            direction.y = 0; 
            direction.normalize();
            
            let right = new THREE.Vector3(direction.z, 0, -direction.x);
            let speed = window.isWheelchairMode ? 0.03 : 0.05;
            
            let mY = Math.abs(currentMoveY) > 0.25 ? currentMoveY : 0;
            let mX = Math.abs(currentMoveX) > 0.25 ? currentMoveX : 0;

            let forwardMult = mY * speed; 
            let rightMult = mX * speed; 
            
            let nextX = rig.object3D.position.x + (direction.x * forwardMult) + (right.x * rightMult);
            let nextZ = rig.object3D.position.z + (direction.z * forwardMult) + (right.z * rightMult);
            let canMove = true;

            let wallLeft = -5.8;
            let wallRight = 9.8; 
            let wallFront = -6.2;
            let wallBack = 5.8;
            
            if (window.isWheelchairMode) {
                wallLeft += 0.3; wallRight -= 0.3; wallFront += 0.3; wallBack -= 0.3;
            }

            if (nextX < wallLeft || nextX > wallRight || nextZ < wallFront || nextZ > wallBack) {
                canMove = false;
            }

            if (canMove) {
                let collidables = document.querySelectorAll('.collidable');
                for (let i = 0; i < collidables.length; i++) {
                    let el = collidables[i];
                    if (el.getAttribute('visible') === 'false') continue; 
                    
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

// Proximity Sensor
AFRAME.registerComponent('proximity-sensor', {
    tick: function () {
        if (!window.isWheelchairMode) return;
        
        let camera = document.getElementById('player-camera');
        let movables = document.querySelectorAll('.movable');
        let tooClose = false;

        movables.forEach((el) => {
            let distance = camera.object3D.position.distanceTo(el.object3D.position);
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