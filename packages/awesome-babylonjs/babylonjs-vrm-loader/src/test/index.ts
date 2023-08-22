import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Axis, Color3, Matrix, Quaternion, Space, Vector3 } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import type { VRMManager } from '../vrm-manager';

import '@babylonjs/core/Helpers/sceneHelpers';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/torusKnotBuilder';
import '@babylonjs/inspector';
// @ts-ignore
import * as dat from 'dat.gui';

// eslint-disable-next-line import/no-internal-modules
import '../index';
import {
    AbstractMesh,
    AmmoJSPlugin,
    AxesViewer,
    HandPart,
    MeshBuilder,
    Tools,
    TransformNode,
    WebXRFeatureName,
    WebXRHand,
    WebXRHandJoint,
    WebXRHandTracking,
    SkeletonViewer,
    AnimationPropertiesOverride,
    BoneIKController,
    Observable as BJSObservable,
} from '@babylonjs/core';
import * as BABYLON from '@babylonjs/core';
import { AdvancedDynamicTexture, Control, Slider, StackPanel, TextBlock, GUI3DManager, StackPanel3D, Button3D } from '@babylonjs/gui';
import { Observable, filter, take, firstValueFrom, map } from 'rxjs';

const { ToRadians, ToDegrees } = Tools;

function fromBabylonObservable<T>(bjsObservable: BJSObservable<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
        if (!(bjsObservable instanceof BJSObservable)) {
            throw new TypeError('the object passed in must be a Babylon Observable');
        }

        const handler = bjsObservable.add((v) => subscriber.next(v));

        return () => bjsObservable.remove(handler);
    });
}

// @ts-ignore
function localAxes(size, scene) {
    const pilot_local_axisX = Mesh.CreateLines(
        'pilot_local_axisX',
        [Vector3.Zero(), new Vector3(size, 0, 0), new Vector3(size * 0.95, 0.05 * size, 0), new Vector3(size, 0, 0), new Vector3(size * 0.95, -0.05 * size, 0)],
        scene,
        false
    );
    pilot_local_axisX.color = new Color3(1, 0, 0);

    const pilot_local_axisY = Mesh.CreateLines(
        'pilot_local_axisY',
        [Vector3.Zero(), new Vector3(0, size, 0), new Vector3(-0.05 * size, size * 0.95, 0), new Vector3(0, size, 0), new Vector3(0.05 * size, size * 0.95, 0)],
        scene,
        false
    );
    pilot_local_axisY.color = new Color3(0, 1, 0);

    const pilot_local_axisZ = Mesh.CreateLines(
        'pilot_local_axisZ',
        [Vector3.Zero(), new Vector3(0, 0, size), new Vector3(0, -0.05 * size, size * 0.95), new Vector3(0, 0, size), new Vector3(0, 0.05 * size, size * 0.95)],
        scene,
        false
    );
    pilot_local_axisZ.color = new Color3(0, 0, 1);

    const local_origin = Mesh.CreateBox('local_origin', 1, scene, false);
    local_origin.isVisible = false;

    pilot_local_axisX.parent = local_origin;
    pilot_local_axisY.parent = local_origin;
    pilot_local_axisZ.parent = local_origin;

    return local_origin;
}
async function main() {
    const debugProperties = getDebugProperties();
    const canvas = document.getElementById('main-canvas') as HTMLCanvasElement;
    const engine = new Engine(canvas, true, {
        alpha: false,
        disableWebGL2Support: debugProperties.webgl1,
    });

    const scene = new Scene(engine);
    const camera = new ArcRotateCamera('MainCamera1', 0, 0, 3, new Vector3(0, 1.2, 0), scene, true);
    // camera.lowerRadiusLimit = 0.1;
    // camera.upperRadiusLimit = 20;
    camera.wheelDeltaPercentage = 0.01;
    // camera.minZ = 0.1;
    camera.position = new Vector3(0, 1.2, -3);
    camera.attachControl(canvas, true);

    scene.createDefaultEnvironment({
        createGround: true,
        createSkybox: false,
        enableGroundMirror: false,
        enableGroundShadow: false,
    });

    // Lights
    const directionalLight = new DirectionalLight('DirectionalLight1', new Vector3(0, -0.5, 1.0), scene);
    directionalLight.position = new Vector3(0, 25, -50);
    directionalLight.setEnabled(true);
    const hemisphericLight = new HemisphericLight('HemisphericLight1', new Vector3(-0.2, -0.8, -1), scene);
    hemisphericLight.setEnabled(false);
    const pointLight = new PointLight('PointLight1', new Vector3(0, 0, 1), scene);
    pointLight.setEnabled(false);

    const shadowCaster = Mesh.CreateTorusKnot('ShadowCaster', 1, 0.2, 32, 32, 2, 3, scene);
    shadowCaster.position = new Vector3(0.0, 5.0, -10.0);
    shadowCaster.setEnabled(debugProperties.shadow);
    if (debugProperties.shadow) {
        const shadowGenerator = new ShadowGenerator(1024, directionalLight);
        shadowGenerator.addShadowCaster(shadowCaster);
    }

    if (debugProperties.inspector) {
        await scene.debugLayer.show({
            globalRoot: document.getElementById('wrapper') as HTMLElement,
            showInspector: true,
        });
    }

    // Expose current scene
    (window as any).currentScene = scene;

    scene.onBeforeRenderObservable.add(() => {
        // SpringBone
        if (!scene.metadata || !scene.metadata.vrmManagers) {
            return;
        }
        const managers = scene.metadata.vrmManagers as VRMManager[];
        const deltaTime = scene.getEngine().getDeltaTime();
        managers.forEach((manager) => {
            manager.update(deltaTime);
        });
    });
    engine.runRenderLoop(() => {
        scene.render();
        shadowCaster.rotate(Vector3.Up(), 0.01);
    });
    window.addEventListener('resize', () => {
        engine.resize();
    });

    let leftHand: WebXRHand;
    let rightHand: WebXRHand;
    let initialPersonRightHandWristPosition: Vector3;
    let initialPersonLeftHandWristPosition: Vector3;

    // @ts-ignore
    await window.Ammo().catch((err) => alert(err));
    scene.enablePhysics(undefined, new AmmoJSPlugin());
    const xr = await scene.createDefaultXRExperienceAsync();

    const xrHandFeature = xr.baseExperience.featuresManager.enableFeature(WebXRFeatureName.HAND_TRACKING, 'latest', {
        xrInput: xr.input,
        jointMeshes: {
            // disableDefaultHandMesh: true,
            // enablePhysics: true,
        },
    }) as unknown as WebXRHandTracking;

    xrHandFeature.onHandAddedObservable.add((newHand: WebXRHand) => {
        const vrmManager = scene.metadata.vrmManagers[0];
        const handedness = newHand.xrController.inputSource.handedness as XRHandedness;
        if (handedness === 'none') return;
        if (handedness === 'left') {
            leftHand = newHand;
            // fromBabylonObservable(scene.onBeforeRenderObservable)
            //     .pipe(
            //         filter(() => {
            //             return newHand.getJointMesh(WebXRHandJoint.WRIST).position.x !== 0;
            //         }),
            //         map(() => newHand.getJointMesh(WebXRHandJoint.WRIST).position),
            //         take(1)
            //     )
            //     .subscribe((v) => {
            //         initialPersonLeftHandWristPosition = v.clone();
            //     });
        } else {
            rightHand = newHand;
            // fromBabylonObservable(scene.onBeforeRenderObservable)
            //     .pipe(
            //         filter(() => {
            //             return newHand.getJointMesh(WebXRHandJoint.WRIST).position.x !== 0;
            //         }),
            //         map(() => newHand.getJointMesh(WebXRHandJoint.WRIST).position),
            //         take(1)
            //     )
            //     .subscribe((v) => {
            //         initialPersonRightHandWristPosition = v.clone();
            //     });
        }
    });

    scene.onBeforeRenderObservable.add(() => {
        if (leftHand && !initialPersonLeftHandWristPosition) {
            // default is 0
            const pos = leftHand.getJointMesh(WebXRHandJoint.WRIST).position;
            if (pos.x !== 0) {
                console.log('左边');
                initialPersonLeftHandWristPosition = pos.clone();
            }
        }

        if (rightHand && !initialPersonRightHandWristPosition) {
            // default is 0
            const pos = rightHand.getJointMesh(WebXRHandJoint.WRIST).position;
            if (pos.x !== 0) {
                console.log('右边');
                initialPersonRightHandWristPosition = pos.clone();
            }
        }
    });

    const gui = new dat.GUI();
    gui.domElement.style.marginTop = '100px';
    gui.domElement.style.marginRight = '300px';
    gui.domElement.id = 'datGUI';

    function setIk(
        direction: 'left' | 'right',
        options: {
            rootMesh: Mesh;
            head: TransformNode;
        }
    ) {
        const { rootMesh, head } = options;
        // TODO: camera的变化带来的变动需要处理
        const xrHeader = xr.baseExperience.camera;
        if (direction === 'right') {
            const bigBall = BABYLON.MeshBuilder.CreateSphere('targetMesh', { diameter: 0.1 }, scene);
            const poleTargetSmallBall = BABYLON.MeshBuilder.CreateSphere('poleMesh', { diameter: 0.05 }, scene);
            poleTargetSmallBall.position = new Vector3(0.47, 1.36, -0.07);
            let initialXrHeaderPosition: Vector3;

            const initialModalRightHand = scene.getTransformNodeByName('RightHand')!;
            const initialModalLeftHand = scene.getTransformNodeByName('LeftHand')!;

            const initialModalRightHandPosition = initialModalRightHand.getAbsolutePosition().clone();
            const initialModalLeftHandPosition = initialModalLeftHand.getAbsolutePosition().clone();

            bigBall.position = new Vector3(-0.45, 1.39, -0.27);
            const initialBigBallPosition = bigBall.position.clone();
            localAxes(0.5, scene).parent = head;
            const ikCtl = new BABYLON.BoneIKController(rootMesh, scene.getBoneByName('RightForeArm')!, {
                targetMesh: bigBall,
                poleTargetMesh: poleTargetSmallBall,
                // poleTargetLocalOffset: new Vector3(1, 1, 1),
                poleAngle: Math.PI * 0.9,
                bendAxis: BABYLON.Vector3.Forward(),
                maxAngle: Math.PI,
                slerpAmount: 5,
            });

            gui.add(ikCtl, 'poleAngle', -Math.PI, Math.PI);
            gui.add(ikCtl, 'maxAngle', 0, Math.PI);

            // ikCtl.maxAngle = Math.PI;
            const headerPosition = head.getAbsolutePosition();
            scene.onBeforeRenderObservable.add(() => {
                ikCtl.update();

                if (xrHeader.position.x === 0 && xrHeader.position.y === 0 && xrHeader.position.z === 0) {
                    return;
                }
                if (!initialXrHeaderPosition) {
                    initialXrHeaderPosition = xrHeader.position.clone();
                }
                if (!initialPersonRightHandWristPosition) return;

                /**
                 * 人的左右手初始位置决定人和模型世界坐标x轴方向。
                 * 如果xl > xr,说明X轴朝左边，旋转了模型，这时候人和模型同一方向， isModalForward是true
                 * 如果xl < xr,说明X轴朝右边，默认方向，这时候人和模型相对， isModalForward是false
                 */

                let isModalForward = false;
                if (initialPersonLeftHandWristPosition?.x > initialPersonRightHandWristPosition?.x) {
                    // xr空间中，需要同时加入双手才检测到手部位置信息
                    isModalForward = true;
                }

                const headerOffset = xrHeader.position.x - initialXrHeaderPosition.x;
                // head.position.x = initialModalHeaderPosition.x + headerOffset * ratio;

                const personRightHandWristPosition = rightHand.getJointMesh(WebXRHandJoint.WRIST).position;

                /**
                 * 1. 计算真人初始手腕位置与头部位置的距离，这是个总距离 lp
                 * 2. 计算模型初始手腕位置与头部位置的距离，这是个总距离 lm
                 * 3. 计算真人的实时手腕位置，这个是lpt
                 * 4. 计算真人手腕移动距离，这个是lp - lpt，即lpDelta
                 * 5. 计算模型手腕初始位置，这个是x1
                 * 6. 计算模型手腕最终位置，这个是x2
                 */

                const lp = initialPersonRightHandWristPosition.x - xrHeader.position.x;
                // 对头部进行补偿，这是因为模型的头没变化。如果模型的头部实时变化，这里就不需要补偿了。但是如果直接修改headerPosition.x，那么模型的头部变化很奇怪。而且ratio也不能直接应用在头部x上，可能模型头部比例和头到手臂的比例不一样。
                const lm = initialBigBallPosition.x - headerPosition.x; // - headerOffset * ratio);
                const ratioX = Math.abs(lm / lp);

                const lpDeltaX = initialPersonRightHandWristPosition.x - personRightHandWristPosition.x; // + xrHeader.position.x - initialXrHeaderPosition.x;
                const lpDeltaY = personRightHandWristPosition.y - initialPersonRightHandWristPosition.y; // y 轴方向相同，x轴相反
                const lpDeltaZ = initialPersonRightHandWristPosition.z - personRightHandWristPosition.z;

                // 向外伸展的时候实际的比例是模型手腕到手肘的举例和真人比例。但是真人没办法获取到xr世界中手肘的位置的，所以ratio和向内不一样，0.9比较接近真实。
                // isModalForward为true，向外lpDeltaX是大于0的。isModalForward为false，向外lpDeltaX是小于0的。
                bigBall.position.x = getAbsSmall(
                    initialBigBallPosition.x + lpDeltaX * ((lpDeltaX < 0 && !isModalForward) || (lpDeltaX > 0 && isModalForward) ? 0.9 : ratioX) * (isModalForward ? -1 : 1),
                    initialModalRightHandPosition.x,
                    initialXrHeaderPosition.x
                );
                bigBall.position.y = initialBigBallPosition.y + lpDeltaY * 2;
                bigBall.position.z = initialBigBallPosition.z + lpDeltaZ * (isModalForward ? -1 : 1);

                setContent(`
                    lpDeltaX: ${lpDeltaX},
                    isModalForward: ${isModalForward},
                `);
            });
        } else {
            const bigBall = BABYLON.MeshBuilder.CreateSphere('targetMesh', { diameter: 0.1 }, scene);
            localAxes(0.5, scene).parent = bigBall;
            const poleTargetSmallBall = BABYLON.MeshBuilder.CreateSphere('poleMesh', { diameter: 0.05 }, scene);
            // poleTargetSmallBall.position = new Vector3(-0.47, 1.36, -0.07);
            poleTargetSmallBall.position = new Vector3(-0.23, 1.44, 0.54);
            let initialXrHeaderPosition: Vector3;
            const initialModalHand = scene.getTransformNodeByName('LeftHand')!;
            const initialModalRightHandPosition = initialModalHand.getAbsolutePosition().clone();

            // @ts-ignore

            bigBall.position = new Vector3(0.53, 1.62, 0.28);
            // bigBall.position = scene.getBoneByName('LeftForeArm')!.getAbsolutePosition().clone();
            // bigBall.position.x *= -1;
            // bigBall.position.z = -0.27;
            // bigBall.position = new Vector3(0.45, 1.39, -0.27);

            const initialBigBallPosition = bigBall.position.clone();
            console.log('坐标', scene.getBoneByName('LeftForeArm')!.position, scene.getBoneByName('LeftForeArm')!.getAbsolutePosition());
            const ikCtl = new BABYLON.BoneIKController(rootMesh, scene.getBoneByName('LeftForeArm')!, {
                targetMesh: bigBall,
                poleTargetMesh: poleTargetSmallBall,
                // poleTargetLocalOffset: new Vector3(1, 1, 1),
                poleAngle: Math.PI * 0.9,
                // bendAxis: new Vector3(-5, 2, -2),
                // bendAxis: new Vector3(-1, 0, -1),
                maxAngle: Math.PI,
            });

            gui.add(ikCtl, 'poleAngle', -Math.PI, Math.PI);
            gui.add(ikCtl, 'maxAngle', 0, Math.PI);
            ikCtl.poleTargetLocalOffset;

            // gui.add(ikCtl.poleTargetLocalOffset, 'x', -1, 1);
            // gui.add(ikCtl.poleTargetLocalOffset, 'y', -1, 1);
            // gui.add(ikCtl.poleTargetLocalOffset, 'z', -1, 1);

            // gui.add(ikCtl, 'maxAngle', 0, Math.PI);

            // gui.add(ikCtl, 'bendAxis.x', 0, 1);
            // gui.add(ikCtl, 'bendAxis.y', 0, 1);
            // gui.add(ikCtl, 'bendAxis.z', 0, 1);

            // ikCtl.maxAngle = Math.PI;
            const headerPosition = head.getAbsolutePosition();
            scene.onBeforeRenderObservable.add(() => {
                ikCtl.update();
                return;
                if (xrHeader.position.x === 0 && xrHeader.position.y === 0 && xrHeader.position.z === 0) {
                    return;
                }
                if (!initialXrHeaderPosition) {
                    initialXrHeaderPosition = xrHeader.position.clone();
                }
                if (!initialPersonLeftHandWristPosition) return;

                const headerOffset = xrHeader.position.x - initialXrHeaderPosition.x;
                // head.position.x = initialModalHeaderPosition.x + headerOffset * ratio;

                const rightHandWristPosition = leftHand.getJointMesh(WebXRHandJoint.WRIST).position;

                /**
                 * 1. 计算真人初始手腕位置与头部位置的距离，这是个总距离 lp
                 * 2. 计算模型初始手腕位置与头部位置的距离，这是个总距离 lm
                 * 3. 计算真人的实时手腕位置，这个是lpt
                 * 4. 计算真人手腕移动距离，这个是lp - lpt，即lpDelta
                 * 5. 计算模型手腕初始位置，这个是x1
                 * 6. 计算模型手腕最终位置，这个是x2
                 */

                const lp = initialPersonLeftHandWristPosition.x - xrHeader.position.x;
                // 对头部进行补偿，这是因为模型的头没变化。如果模型的头部实时变化，这里就不需要补偿了。但是如果直接修改headerPosition.x，那么模型的头部变化很奇怪。而且ratio也不能直接应用在头部x上，可能模型头部比例和头到手臂的比例不一样。
                const lm = initialModalRightHandPosition.x - headerPosition.x; // - headerOffset * ratio);
                const ratioX = Math.abs(lm / lp);
                const ratioY = Math.abs((initialModalRightHandPosition.y - headerPosition.y) / (initialPersonLeftHandWristPosition.y - xrHeader.position.y));
                const ratioZ = Math.abs((initialModalRightHandPosition.z - headerPosition.z) / (initialPersonLeftHandWristPosition.z - xrHeader.position.z));

                const lpDeltaX = initialPersonLeftHandWristPosition.x - rightHandWristPosition.x; // + xrHeader.position.x - initialXrHeaderPosition.x;
                const lpDeltaY = rightHandWristPosition.y - initialPersonLeftHandWristPosition.y; // y 轴方向相同，x轴相反
                const lpDeltaZ = initialPersonLeftHandWristPosition.z - rightHandWristPosition.z;

                // 因为向外伸展的时候是没办法获取到xr世界中手肘的位置的，所以ratio和向内不一样，0.9比较接近真实
                bigBall.position.x = getAbsSmall(initialBigBallPosition.x + lpDeltaX * (lpDeltaX < 0 ? 0.9 : ratioX), initialModalRightHandPosition.x, initialXrHeaderPosition.x);
                // bigBall.position.x = x2;
                bigBall.position.y = initialBigBallPosition.y + lpDeltaY * 2;
                bigBall.position.z = initialBigBallPosition.z + lpDeltaZ;
            });
        }
    }

    xr.baseExperience.sessionManager.onXRSessionEnded.add(() => {});
    // SceneLoader.AppendAsync('./', 'K-00510.vrm', scene).then((scene: Scene) => {
    //     const rootMesh = scene.getMeshByName('__root__')! as Mesh;
    //     // @ts-ignore
    //     window.rootMesh = rootMesh;
    //     // @ts-ignore
    //     window.scene = scene;
    //     // 头
    //     const head = scene.getTransformNodeByName('Head')!;

    //     let initialXrHeaderPosition: Vector3;

    //     // left right
    //     setIk('right', {
    //         rootMesh,
    //         head,
    //     });

    //     // makePose(manager);
    // });

    var target = BABYLON.MeshBuilder.CreateSphere('', { diameter: 5 }, scene);
    var poleTarget = BABYLON.MeshBuilder.CreateSphere('', { diameter: 2.5 }, scene);

    SceneLoader.ImportMesh('', './', 'Dude.babylon', scene, function (newMeshes, particleSystems, skeletons) {
        var mesh = newMeshes[0] as Mesh;
        // mesh.rotate(Axis.Y, Math.PI, Space.WORLD);
        var skeleton = skeletons[0];
        mesh.scaling = new BABYLON.Vector3(0.02, 0.02, 0.02);
        mesh.position = new BABYLON.Vector3(0, 0, 0);

        // var animation = scene.beginAnimation(skeletons[0], 0, 100, true, 1.0);

        var t = 0;

        poleTarget.position.x = 0;
        poleTarget.position.y = 100;
        poleTarget.position.z = -50;

        target.parent = mesh;
        poleTarget.parent = mesh;

        var ikCtl = new BABYLON.BoneIKController(mesh, skeleton.bones[14], { targetMesh: target, poleTargetMesh: poleTarget, poleAngle: Math.PI });

        ikCtl.maxAngle = Math.PI * 0.9;

        var bone1AxesViewer = new BABYLON.BoneAxesViewer(scene, skeleton.bones[14], mesh);
        var bone2AxesViewer = new BABYLON.BoneAxesViewer(scene, skeleton.bones[13], mesh);
        bone1AxesViewer.scaleLines = 0.2;
        bone2AxesViewer.scaleLines = 0.2;

        gui.add(ikCtl, 'poleAngle', -Math.PI, Math.PI);
        gui.add(ikCtl, 'maxAngle', 0, Math.PI);
        gui.add(poleTarget.position, 'x', -100, 100).name('pole target x');
        gui.add(poleTarget.position, 'y', -100, 100).name('pole target y');
        gui.add(poleTarget.position, 'z', -100, 100).name('pole target z');

        scene.registerBeforeRender(function () {
            var bone = skeleton.bones[14];

            t += 0.03;

            // var dist = 2 + 12 * Math.sin(t);

            target.position.x = 20;
            target.position.y = 40 + 40 * Math.sin(t);
            target.position.z = -30 + 40 * Math.cos(t);

            ikCtl.update();

            //mesh.rotation.y += .01;

            bone1AxesViewer.update();
            bone2AxesViewer.update();
        });
    });

    function getAbsSmall(v1: number, v2: number, base: number) {
        // 如果在base的同一侧
        if ((v1 > base && v2 > base) || (v1 < base && v2 < base)) {
            const absV1 = Math.abs(v1);
            const absV2 = Math.abs(v2);
            return absV1 > absV2 ? v2 : v1;
        }
        return v1;
    }

    const axes = new AxesViewer();

    const manager = new GUI3DManager(scene);

    // Create a horizontal stack panel
    const panel = new StackPanel3D();
    panel.margin = 0.02;

    manager.addControl(panel);
    panel.position.z = -1.5;

    // Let's add some buttons!
    const addButton = function () {
        const button = new Button3D('orientation', { width: 2 });
        panel.addControl(button);
        // button.onPointerUpObservable.add(function () {
        //     panel.isVertical = !panel.isVertical;
        // });

        const text1 = new TextBlock();
        text1.text = 'change orientation';
        text1.color = 'white';
        text1.fontSize = 12;
        button.content = text1;
        button.position.z = 2;
        button.position.y = 0.5;
        button.scaling = new Vector3(0.5, 0.5, 0.5);
        // button.mesh!.rotation.y = Math.PI;

        const setContent = (text2: string) => {
            text1.text = text2;
        };

        return setContent;
    };

    const setContent = addButton();

    function getAngle(originMesh: TransformNode, mesh1: TransformNode, mesh2: TransformNode) {
        const line1 = originMesh.position.subtract(mesh1.position);
        const line2 = originMesh.position.subtract(mesh2.position);
        const normal = Vector3.Cross(line1, line2).normalize();

        const angle = Vector3.GetAngleBetweenVectors(line1, line2, normal);
        return angle;
    }

    function getPersonJoint(hand: WebXRHand) {
        const wristMesh0 = hand.getJointMesh(WebXRHandJoint.WRIST); // 手腕
        const thumb1 = hand.getJointMesh(WebXRHandJoint.THUMB_METACARPAL); // 拇指
        const thumb2 = hand.getJointMesh(WebXRHandJoint.THUMB_PHALANX_PROXIMAL);
        const thumb3 = hand.getJointMesh(WebXRHandJoint.THUMB_PHALANX_DISTAL);
        const thumb4 = hand.getJointMesh(WebXRHandJoint.THUMB_TIP);
        const index5 = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_METACARPAL);
        const index6 = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL);
        const index7 = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_PHALANX_INTERMEDIATE);
        const index8 = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_PHALANX_DISTAL);
        const index9 = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP);
        const middle10 = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_METACARPAL);
        const middle11 = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL);
        const middle12 = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_PHALANX_INTERMEDIATE);
        const middle13 = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_PHALANX_DISTAL);
        const middle14 = hand.getJointMesh(WebXRHandJoint.MIDDLE_FINGER_TIP);
        const ring15 = hand.getJointMesh(WebXRHandJoint.RING_FINGER_METACARPAL);
        const ring16 = hand.getJointMesh(WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL);
        const ring17 = hand.getJointMesh(WebXRHandJoint.RING_FINGER_PHALANX_INTERMEDIATE);
        const ring18 = hand.getJointMesh(WebXRHandJoint.RING_FINGER_PHALANX_DISTAL);
        const ring19 = hand.getJointMesh(WebXRHandJoint.RING_FINGER_TIP);
        const little20 = hand.getJointMesh(WebXRHandJoint.PINKY_FINGER_METACARPAL);
        const little21 = hand.getJointMesh(WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL);
        const little22 = hand.getJointMesh(WebXRHandJoint.PINKY_FINGER_PHALANX_INTERMEDIATE);
        const little23 = hand.getJointMesh(WebXRHandJoint.PINKY_FINGER_PHALANX_DISTAL);
        const little24 = hand.getJointMesh(WebXRHandJoint.PINKY_FINGER_TIP);
        return {
            wristMesh0,
            thumb1,
            thumb2,
            thumb3,
            thumb4,
            index5,
            index6,
            index7,
            index8,
            index9,
            middle10,
            middle11,
            middle12,
            middle13,
            middle14,
            ring15,
            ring16,
            ring17,
            ring18,
            ring19,
            little20,
            little21,
            little22,
            little23,
            little24,
        };
    }

    function makeLeftHandSync(hand: WebXRHand) {
        const bone = scene.metadata.vrmManagers[0].humanoidBone;
        const {
            wristMesh0,
            thumb1,
            thumb2,
            thumb3,
            thumb4,
            index5,
            index6,
            index7,
            index8,
            index9,
            middle10,
            middle11,
            middle12,
            middle13,
            middle14,
            ring15,
            ring16,
            ring17,
            ring18,
            ring19,
            little20,
            little21,
            little22,
            little23,
            little24,
        } = getPersonJoint(hand);

        const wristEa = wristMesh0.rotationQuaternion?.toEulerAngles()!;
        // 手腕
        {
            bone['leftHand'].rotationQuaternion = Quaternion.FromEulerAngles(wristEa.z, -wristEa.y, wristEa.x);
        }
        // 拇指
        {
            setModalJointYAxis(bone['leftThumbProximal'], [thumb1, wristMesh0, thumb2], 'left');
            setModalJointYAxis(bone['leftThumbIntermediate'], [thumb2, thumb1, thumb3], 'left');
            setModalJointYAxis(bone['leftThumbDistal'], [thumb3, thumb2, thumb4], 'left');
        }
        // 食指
        {
            setModalJointZAxis(bone['leftIndexProximal'], [index6, index5, index7], 'left');
            setModalJointZAxis(bone['leftIndexIntermediate'], [index7, index6, index8], 'left');
            setModalJointZAxis(bone['leftIndexDistal'], [index8, index7, index9], 'left');
        }

        // 中指
        {
            setModalJointZAxis(bone['leftMiddleProximal'], [middle11, middle10, middle12], 'left');
            setModalJointZAxis(bone['leftMiddleIntermediate'], [middle12, middle11, middle13], 'left');
            setModalJointZAxis(bone['leftMiddleDistal'], [middle13, middle12, middle14], 'left');
        }
        // 无名指
        {
            setModalJointZAxis(bone['leftRingProximal'], [ring16, ring15, ring17], 'left');
            setModalJointZAxis(bone['leftRingIntermediate'], [ring17, ring16, ring18], 'left');
            setModalJointZAxis(bone['leftRingDistal'], [ring18, ring17, ring19], 'left');
        }
        // 小指
        {
            setModalJointZAxis(bone['leftLittleProximal'], [little21, little20, little22], 'left');
            setModalJointZAxis(bone['leftLittleIntermediate'], [little22, little21, little23], 'left');
            setModalJointZAxis(bone['leftLittleDistal'], [little23, little22, little24], 'left');
        }
    }

    function makeRightHandSync(hand: WebXRHand) {
        const bone = scene.metadata.vrmManagers[0].humanoidBone;
        const {
            wristMesh0,
            thumb1,
            thumb2,
            thumb3,
            thumb4,
            index5,
            index6,
            index7,
            index8,
            index9,
            middle10,
            middle11,
            middle12,
            middle13,
            middle14,
            ring15,
            ring16,
            ring17,
            ring18,
            ring19,
            little20,
            little21,
            little22,
            little23,
            little24,
        } = getPersonJoint(hand);

        const wristEa = wristMesh0.rotationQuaternion?.toEulerAngles()!;
        // 手腕
        {
            bone['rightHand'].rotationQuaternion = null;
            bone['rightHand'].rotate(Axis.Y, 0, Space.WORLD); // 猜想只要设置两个轴，因为IK在运动的时候，会自动旋转一个轴。设置了Y旋转反而报错
            bone['rightHand'].rotate(Axis.X, wristEa.x, Space.WORLD);
            bone['rightHand'].rotate(Axis.Z, wristEa.z + Math.PI / 2, Space.WORLD);
        }
        // 拇指
        {
            setModalJointYAxis(bone['rightThumbProximal'], [thumb1, wristMesh0, thumb2], 'right');
            setModalJointYAxis(bone['rightThumbIntermediate'], [thumb2, thumb1, thumb3], 'right');
            setModalJointYAxis(bone['rightThumbDistal'], [thumb3, thumb2, thumb4], 'right');
        }
        // 食指
        {
            setModalJointZAxis(bone['rightIndexProximal'], [index6, index5, index7], 'right');
            setModalJointZAxis(bone['rightIndexIntermediate'], [index7, index6, index8], 'right');
            setModalJointZAxis(bone['rightIndexDistal'], [index8, index7, index9], 'right');
        }
        // 中指
        {
            setModalJointZAxis(bone['rightMiddleProximal'], [middle11, middle10, middle12], 'right');
            setModalJointZAxis(bone['rightMiddleIntermediate'], [middle12, middle11, middle13], 'right');
            setModalJointZAxis(bone['rightMiddleDistal'], [middle13, middle12, middle14], 'right');
        }
        // 无名指
        {
            setModalJointZAxis(bone['rightRingProximal'], [ring16, ring15, ring17], 'right');
            setModalJointZAxis(bone['rightRingIntermediate'], [ring17, ring16, ring18], 'right');
            setModalJointZAxis(bone['rightRingDistal'], [ring18, ring17, ring19], 'right');
        }
        // 小指
        {
            setModalJointZAxis(bone['rightLittleProximal'], [little21, little20, little22], 'right');
            setModalJointZAxis(bone['rightLittleIntermediate'], [little22, little21, little23], 'right');
            setModalJointZAxis(bone['rightLittleDistal'], [little23, little22, little24], 'right');
        }
    }

    function setModalJointZAxis(modalJoint: any, jointsMesh: AbstractMesh[], direction: 'left' | 'right') {
        let angle = getAngle(jointsMesh[0], jointsMesh[1], jointsMesh[2]) - Math.PI;
        if (direction === 'left') {
            angle *= -1;
        }
        modalJoint.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, angle);
    }

    function setModalJointYAxis(modalJoint: any, jointsMesh: AbstractMesh[], direction: 'left' | 'right') {
        let angle = getAngle(jointsMesh[0], jointsMesh[1], jointsMesh[2]) - Math.PI;
        if (direction === 'left') {
            angle *= -1;
        }
        modalJoint.rotationQuaternion = Quaternion.FromEulerAngles(0, angle, 0);
    }

    scene.onBeforeRenderObservable.add(() => {
        // if (!leftHand || !rightHand) return;

        if (leftHand) {
            makeLeftHandSync(leftHand);
        }
        if (rightHand) {
            makeRightHandSync(rightHand);
        }
    });
}

interface DebugProperties {
    webgl1: boolean;
    shadow: boolean;
    inspector: boolean;
}

function getDebugProperties(): DebugProperties {
    const href = window.location.href;

    return {
        webgl1: href.includes('webgl1'),
        shadow: href.includes('shadow'),
        inspector: href.includes('inspector'),
    };
}

main().catch((reason) => {
    console.error(reason);
});
