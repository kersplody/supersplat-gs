import { Button, Container, Label, NumericInput, SelectInput } from '@playcanvas/pcui';
import { BLEND_NORMAL, Color, Entity, Mat4, Quat, StandardMaterial, TranslateGizmo, Vec3 } from 'playcanvas';

import { EntityTransformOp } from '../edit-ops';
import { Events } from '../events';
import { Scene } from '../scene';
import { Splat } from '../splat';
import { State } from '../splat-state';
import { Transform } from '../transform';
import { localize } from '../ui/localization';

const mat = new Mat4();
const mat1 = new Mat4();
const mat2 = new Mat4();
const mat3 = new Mat4();
const p = new Vec3();
const p0 = new Vec3();
const p1 = new Vec3();
const p2 = new Vec3();
const r = new Quat();
const s = new Vec3();

const t = new Transform();
const tmpA = new Vec3();
const tmpB = new Vec3();
const tmpC = new Vec3();

class MeasureTransformHandler {
    activate() {}
    deactivate() {}
}

class CalloutTool {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, scene: Scene, parent: HTMLElement, canvasContainer: Container) {
        const idPrefix = 'annotation';
        const isAnnotationTool = true;

        // create svg
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden', 'measure-tool-svg');
        svg.id = `${idPrefix}-tool-svg`;
        parent.appendChild(svg);

        const ns = svg.namespaceURI;

        // create defs node
        const defs = document.createElementNS(ns, 'defs');

        // create line element
        const line = document.createElementNS(ns, 'line') as SVGLineElement;
        line.id = `${idPrefix}-line`;
        defs.appendChild(line);

        const lineBottom = document.createElementNS(ns, 'use') as SVGUseElement;
        lineBottom.classList.add('measure-line-bottom');
        lineBottom.setAttribute('href', `#${line.id}`);

        const lineTop = document.createElementNS(ns, 'use') as SVGUseElement;
        lineTop.classList.add('measure-line-top');
        lineTop.setAttribute('href', `#${line.id}`);

        const line2 = document.createElementNS(ns, 'line') as SVGLineElement;
        line2.id = `${idPrefix}-line-2`;
        defs.appendChild(line2);

        const line2Bottom = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Bottom.classList.add('measure-line-bottom');
        line2Bottom.setAttribute('href', `#${line2.id}`);

        const line2Top = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Top.classList.add('measure-line-top');
        line2Top.setAttribute('href', `#${line2.id}`);

        // create line ends
        const lineStart = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineStart.classList.add('measure-line-point');

        const lineMid = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineMid.classList.add('measure-line-point');

        const lineEnd = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineEnd.classList.add('measure-line-point');

        const lineExtra = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineExtra.classList.add('measure-line-point');

        svg.appendChild(defs);
        svg.appendChild(lineBottom);
        svg.appendChild(lineTop);
        svg.appendChild(line2Bottom);
        svg.appendChild(line2Top);
        svg.appendChild(lineStart);
        svg.appendChild(lineMid);
        svg.appendChild(lineEnd);
        svg.appendChild(lineExtra);

        // ui
        const lengthLabel = !isAnnotationTool ? new Label({
            text: localize('measure.length')
        }) : null;

        const lengthInput = !isAnnotationTool ? new NumericInput({
            width: 90,
            placeholder: 'm',
            precision: 2,
            min: 0.0001,
            value: 0
        }) : null;

        const lengthUnit = !isAnnotationTool ? new SelectInput({
            class: 'measure-unit-select',
            defaultValue: 'm',
            options: [
                { v: 'm', t: 'm' },
                { v: 'cm', t: 'cm' },
                { v: 'ft', t: 'ft' },
                { v: 'in', t: 'in' }
            ]
        }) : null;
        const copyButton = isAnnotationTool ? new Button({
            class: 'select-toolbar-button',
            text: 'COPY CALLOUT'
        }) : null;
        const clearButton = new Button({
            class: 'select-toolbar-button',
            text: 'Clear'
        });
        let suppressUI = 0;

        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });

        if (lengthLabel && lengthInput && lengthUnit) {
            selectToolbar.append(lengthLabel);
            selectToolbar.append(lengthInput);
            selectToolbar.append(lengthUnit);
        }
        if (copyButton) {
            selectToolbar.append(copyButton);
        }
        selectToolbar.append(clearButton);
        canvasContainer.append(selectToolbar);

        const gizmo = new TranslateGizmo(scene.camera.camera, scene.gizmoLayer);
        const entity = new Entity('measureGizmoPivot');
        const transformHandler = new MeasureTransformHandler();
        const annotationPreviewRoot = isAnnotationTool ? new Entity('annotationPreviewRoot') : null;
        const annotationPreviewSegments = [] as Entity[];
        const annotationPreviewDecoratorStart = isAnnotationTool ? new Entity('annotationPreviewDecoratorStart') : null;
        const annotationPreviewDecoratorEnd = isAnnotationTool ? new Entity('annotationPreviewDecoratorEnd') : null;
        const annotationPreviewFill = isAnnotationTool ? new Entity('annotationPreviewFill') : null;
        const annotationMeasurementLabels = isAnnotationTool ?
            [document.createElement('div'), document.createElement('div'), document.createElement('div')] :
            [];

        let active = false;
        let splat: Splat;
        const positionsCache = new WeakMap<Splat, Float32Array>();
        const screenSearchRadius = 24;
        const densityRadius = 0.35;
        const zBinSize = 0.15;
        const maxSnapOffset = 2;
        const minClusterCount = 2;
        let ctrlPressed = false;
        let snapDraggedPoint = false;
        let settingAnnotationPosition = false;
        let updatingAnnotationDraft = false;
        let annotationDraft: {
            lineColor?: [number, number, number, number],
            boxColor?: [number, number, number, number],
            lineThickness?: number,
            lineDecorator?: 'none' | 'box' | 'arrowheads',
            showMeasurement?: boolean,
            measurementUnits?: 'm' | 'ft' | 'in' | 'cm'
        } | undefined;

        const getActivePoints = () => {
            if (!splat) {
                return [] as Vec3[];
            }
            return isAnnotationTool ? splat.annotationPoints : splat.measurePoints;
        };

        const getSelection = () => {
            if (!splat) {
                return -1;
            }
            return isAnnotationTool ? splat.annotationSelection : splat.measureSelection;
        };

        const setSelection = (value: number) => {
            if (!splat) {
                return;
            }
            if (isAnnotationTool) {
                splat.annotationSelection = value;
            } else {
                splat.measureSelection = value;
            }
        };

        const getPointCount = () => {
            if (!splat) {
                return 0;
            }
            return isAnnotationTool ? (splat.annotationLabelPosition ? 1 : 0) + splat.annotationPoints.length : splat.measurePoints.length;
        };

        const getAnnotationHandleLocal = (index: number) => {
            if (!splat) {
                return null;
            }
            if (index === 0) {
                return splat.annotationLabelPosition;
            }
            return splat.annotationPoints[index - 1] ?? null;
        };

        const setAnnotationHandleLocal = (index: number, value: Vec3) => {
            if (!splat) {
                return;
            }
            if (index === 0) {
                splat.annotationLabelPosition = value.clone();
                splat.worldTransform.transformPoint(value, p);
                updatingAnnotationDraft = true;
                events.fire('annotation.setDraft', {
                    position: [p.x, p.y, p.z]
                });
                updatingAnnotationDraft = false;
            } else {
                splat.annotationPoints[index - 1] = value.clone();
            }
        };

        const createPrimitiveMaterial = (rgba: [number, number, number, number]) => {
            const color = new Color(rgba[0], rgba[1], rgba[2], rgba[3]);
            const material = new StandardMaterial();
            material.diffuse.set(color.r, color.g, color.b);
            material.emissive.set(color.r, color.g, color.b);
            material.useLighting = false;
            material.opacity = color.a;
            if (color.a < 1) {
                material.blendType = BLEND_NORMAL;
                material.depthWrite = false;
            }
            material.update();
            material.setParameter('material_opacity', color.a);
            return material;
        };

        const syncRenderOpacity = (renderEntity: Entity, opacity: number) => {
            renderEntity.render?.meshInstances?.forEach((meshInstance) => {
                meshInstance.setParameter('material_opacity', opacity);
            });
        };

        const setMaterialRgba = (material: StandardMaterial, rgba: [number, number, number, number]) => {
            material.diffuse.set(rgba[0], rgba[1], rgba[2]);
            material.emissive.set(rgba[0], rgba[1], rgba[2]);
            material.opacity = rgba[3];
            if (rgba[3] < 1) {
                material.blendType = BLEND_NORMAL;
                material.depthWrite = false;
            } else {
                material.depthWrite = true;
            }
            material.update();
            material.setParameter('material_opacity', rgba[3]);
        };

        const configureSegmentTransform = (segmentEntity: Entity, start: Vec3, end: Vec3, thickness: number) => {
            tmpA.sub2(end, start);
            const length = tmpA.length();
            if (length <= 1e-6) {
                segmentEntity.setLocalScale(0, 0, 0);
                return;
            }

            tmpB.add2(start, end).mulScalar(0.5);
            segmentEntity.setPosition(tmpB);
            segmentEntity.lookAt(end);
            segmentEntity.setLocalScale(thickness, thickness, length);
        };

        const configureBoxDecorator = (decoratorEntity: Entity, point: Vec3, thickness: number) => {
            decoratorEntity.setPosition(point);
            decoratorEntity.setEulerAngles(0, 0, 0);
            decoratorEntity.setLocalScale(thickness * 2.5, thickness * 2.5, thickness * 2.5);
        };

        const configureArrowDecorator = (decoratorEntity: Entity, point: Vec3, direction: Vec3, thickness: number, forward: boolean) => {
            const headLength = thickness * 4;
            tmpA.copy(direction).normalize().mulScalar(forward ? 1 : -1);
            tmpB.copy(tmpA).mulScalar(-headLength * 0.5).add(point);
            decoratorEntity.setPosition(tmpB);
            tmpC.add2(tmpB, tmpA);
            decoratorEntity.lookAt(tmpC);
            decoratorEntity.rotateLocal(90, 0, 0);
            decoratorEntity.setLocalScale(thickness * 2.2, headLength, thickness * 2.2);
        };

        const computeThicknessWorld = (anchor: Vec3, lineThickness: number) => {
            const camera = scene.camera.camera;
            const viewMatrix = camera.viewMatrix;
            viewMatrix.transformPoint(anchor, tmpA);
            const depth = Math.max(0.1, -tmpA.z);
            const { width, height } = scene.app.graphicsDevice.clientRect;
            const fovRad = camera.fov * Math.PI / 180;
            const worldSpan = 2 * depth * Math.tan(fovRad * 0.5);
            const worldPerPixel = camera.horizontalFov ? worldSpan / width : worldSpan / height;
            return Math.max(0.001, lineThickness * worldPerPixel);
        };

        const getMeasureScale = () => {
            const value = events.invoke('view.measureScale');
            return Number.isFinite(value) && value > 0 ? value : 1;
        };

        if (isAnnotationTool && annotationPreviewRoot) {
            const edgeMaterial = createPrimitiveMaterial(annotationDraft?.lineColor ?? [1, 0.4, 0, 1]);
            const fillMaterial = createPrimitiveMaterial(annotationDraft?.boxColor ?? [1, 0.4, 0, 0.15]);

            for (let i = 0; i < 12; i++) {
                const segmentEntity = new Entity(`annotationPreviewSegment${i}`);
                segmentEntity.addComponent('render', {
                    type: 'box',
                    material: edgeMaterial
                });
                annotationPreviewRoot.addChild(segmentEntity);
                annotationPreviewSegments.push(segmentEntity);
            }

            annotationPreviewDecoratorStart.addComponent('render', {
                type: 'box',
                material: edgeMaterial
            });
            annotationPreviewDecoratorEnd.addComponent('render', {
                type: 'box',
                material: edgeMaterial
            });
            annotationPreviewFill.addComponent('render', {
                type: 'box',
                material: fillMaterial
            });

            annotationPreviewRoot.addChild(annotationPreviewDecoratorStart);
            annotationPreviewRoot.addChild(annotationPreviewDecoratorEnd);
            annotationPreviewRoot.addChild(annotationPreviewFill);
            annotationPreviewRoot.enabled = false;
            scene.contentRoot.addChild(annotationPreviewRoot);
            annotationMeasurementLabels.forEach((label) => {
                label.className = 'annotation-preview-measure';
                label.style.display = 'none';
                canvasContainer.dom.appendChild(label);
            });
        }

        const formatLength = (value: number) => {
            return value >= 100 ? value.toFixed(1) : value.toFixed(2);
        };

        const units = {
            m: {
                toDisplay: (meters: number) => meters,
                toMeters: (value: number) => value,
                suffix: 'm',
                convertedLabel: (meters: number) => `${formatLength(meters * 3.280839895)} ft`
            },
            cm: {
                toDisplay: (meters: number) => meters * 100,
                toMeters: (value: number) => value / 100,
                suffix: 'cm',
                convertedLabel: (meters: number) => `${formatLength(meters)} m`
            },
            ft: {
                toDisplay: (meters: number) => meters * 3.280839895,
                toMeters: (value: number) => value / 3.280839895,
                suffix: 'ft',
                convertedLabel: (meters: number) => `${formatLength(meters)} m`
            },
            in: {
                toDisplay: (meters: number) => meters * 39.37007874,
                toMeters: (value: number) => value / 39.37007874,
                suffix: 'in',
                convertedLabel: (meters: number) => `${formatLength(meters)} m`
            }
        } as const;

        const getCurrentUnit = () => {
            if (!lengthUnit) {
                return 'm';
            }
            return units[lengthUnit.value as keyof typeof units] ? lengthUnit.value as keyof typeof units : 'm';
        };

        // get world space point
        const getPoint = (index: number, result: Vec3) => {
            if (isAnnotationTool) {
                const localPoint = getAnnotationHandleLocal(index);
                if (!localPoint) {
                    result.set(0, 0, 0);
                    return;
                }
                splat.worldTransform.transformPoint(localPoint, result);
                return;
            }
            splat.worldTransform.transformPoint(splat.measurePoints[index], result);
        };

        const getPoint2d = (index: number, result: Vec3) => {
            getPoint(index, result);
            scene.camera.worldToScreen(result, result);
            result.x *= canvasContainer.dom.clientWidth;
            result.y *= canvasContainer.dom.clientHeight;
        };

        const publishActivePoint = () => {
            const selection = getSelection();
            if (splat && active && selection >= 0 && selection < getPointCount()) {
                getPoint(selection, p);
                events.fire('measure.activePoint', {
                    x: p.x,
                    y: p.y,
                    z: p.z
                });
            } else {
                events.fire('measure.activePoint', null);
            }
        };

        const useCreationSnap = () => {
            const extensions = events.invoke('settings.extensions') as { sceneRotation?: { x: number, y: number, z: number } } | undefined;
            return !!extensions?.sceneRotation;
        };

        const getWorldPositions = async (targetSplat: Splat) => {
            let positions = positionsCache.get(targetSplat);
            if (!positions) {
                positions = await scene.dataProcessor.calcPositions(targetSplat);
                positionsCache.set(targetSplat, positions);
            }
            return positions;
        };

        const snapCreatedPoint = async (targetSplat: Splat, screenX: number, screenY: number, fallback: Vec3, clampToFallback = true) => {
            if (!targetSplat) {
                return fallback;
            }

            const positions = await getWorldPositions(targetSplat);
            const state = targetSplat.splatData.getProp('state') as Uint8Array ?? new Uint8Array(targetSplat.splatData.numSplats);
            const cameraPosition = scene.camera.position;
            const cameraForward = scene.camera.forward;
            const candidates: { x: number, y: number, z: number, depth: number }[] = [];

            for (let i = 0; i < targetSplat.splatData.numSplats; i++) {
                if ((state[i] & State.deleted) !== 0) {
                    continue;
                }

                p2.set(positions[i * 4], positions[i * 4 + 1], positions[i * 4 + 2]);
                if (!Number.isFinite(p2.x) || !Number.isFinite(p2.y) || !Number.isFinite(p2.z)) {
                    continue;
                }

                scene.camera.worldToScreen(p2, p);
                p.x *= canvasContainer.dom.clientWidth;
                p.y *= canvasContainer.dom.clientHeight;

                const dx = p.x - screenX;
                const dy = p.y - screenY;
                const distSq = dx * dx + dy * dy;
                if (distSq <= screenSearchRadius * screenSearchRadius) {
                    p.sub2(p2, cameraPosition);
                    const depth = p.dot(cameraForward);
                    if (depth > 0) {
                        candidates.push({
                            x: p2.x,
                            y: p2.y,
                            z: p2.z,
                            depth
                        });
                    }
                }
            }

            if (candidates.length === 0) {
                return fallback;
            }

            const buckets = new Map<number, { count: number, xSum: number, ySum: number, zSum: number, depthSum: number }>();
            let bestBucket: { count: number, xSum: number, ySum: number, zSum: number, depthSum: number } | null = null;

            for (const candidate of candidates) {
                const key = Math.round(candidate.depth / zBinSize);
                const bucket = buckets.get(key) ?? { count: 0, xSum: 0, ySum: 0, zSum: 0, depthSum: 0 };
                bucket.count++;
                bucket.xSum += candidate.x;
                bucket.ySum += candidate.y;
                bucket.zSum += candidate.z;
                bucket.depthSum += candidate.depth;
                buckets.set(key, bucket);

                const bucketDepth = bucket.depthSum / bucket.count;
                const bestDepth = bestBucket ? bestBucket.depthSum / bestBucket.count : Infinity;
                if (!bestBucket || bucket.count > bestBucket.count || (bucket.count === bestBucket.count && bucketDepth < bestDepth)) {
                    bestBucket = bucket;
                }
            }

            if (!bestBucket) {
                return fallback;
            }

            const anchorX = bestBucket.xSum / bestBucket.count;
            const anchorY = bestBucket.ySum / bestBucket.count;
            const anchorZ = bestBucket.zSum / bestBucket.count;
            const nearby = candidates.filter((candidate) => {
                const dx = candidate.x - anchorX;
                const dy = candidate.y - anchorY;
                return dx * dx + dy * dy <= densityRadius * densityRadius;
            });

            if (nearby.length > 0) {
                const refinedBuckets = new Map<number, { count: number, zSum: number, depthSum: number }>();
                let refinedBest: { count: number, zSum: number, depthSum: number } | null = null;

                for (const candidate of nearby) {
                    const key = Math.round(candidate.depth / zBinSize);
                    const bucket = refinedBuckets.get(key) ?? { count: 0, zSum: 0, depthSum: 0 };
                    bucket.count++;
                    bucket.zSum += candidate.z;
                    bucket.depthSum += candidate.depth;
                    refinedBuckets.set(key, bucket);

                    const bucketDepth = bucket.depthSum / bucket.count;
                    const bestDepth = refinedBest ? refinedBest.depthSum / refinedBest.count : Infinity;
                    if (!refinedBest || bucket.count > refinedBest.count || (bucket.count === refinedBest.count && bucketDepth < bestDepth)) {
                        refinedBest = bucket;
                    }
                }

                if (refinedBest) {
                    const snappedZ = refinedBest.zSum / refinedBest.count;
                    if (!clampToFallback) {
                        return new Vec3(anchorX, anchorY, snappedZ);
                    }

                    const snapOffset = Math.abs(fallback.z - snappedZ);
                    if (refinedBest.count >= minClusterCount && snapOffset <= maxSnapOffset) {
                        return new Vec3(anchorX, anchorY, snappedZ);
                    }
                }
            }

            if (!clampToFallback) {
                return new Vec3(anchorX, anchorY, anchorZ);
            }

            const snapOffset = Math.abs(fallback.z - anchorZ);
            if (bestBucket.count >= minClusterCount && snapOffset <= maxSnapOffset) {
                return new Vec3(anchorX, anchorY, anchorZ);
            }

            return fallback;
        };

        const updateVisuals = () => {
            gizmo.detach();
            const selection = getSelection();

            if (splat && active && selection >= 0 && selection < getPointCount()) {
                getPoint(selection, p);
                t.set(p, Quat.IDENTITY, Vec3.ONE);
                events.invoke('pivot').place(t);
                entity.setLocalPosition(p);
                gizmo.attach(entity);
            }

            if (!isAnnotationTool && splat && splat.measurePoints.length >= 2) {
                getPoint(0, p0);
                getPoint(1, p1);
                let lenMeters = p0.distance(p1);
                if (splat.measurePoints.length >= 3) {
                    getPoint(2, p2);
                    lenMeters += p1.distance(p2);
                }
                lenMeters *= getMeasureScale();
                const unit = getCurrentUnit();
                const len = units[unit].toDisplay(lenMeters);

                suppressUI++;
                lengthInput.value = len;
                lengthInput.placeholder = '';
                lengthInput.enabled = true;
                suppressUI--;
            } else if (!isAnnotationTool && lengthInput) {
                lengthInput.enabled = false;
                lengthInput.placeholder = '';
            }

            publishActivePoint();
            updateAnnotationPreview();
        };

        const updateAnnotationPreview = () => {
            if (!isAnnotationTool || !annotationPreviewRoot || !splat) {
                return;
            }

            annotationPreviewRoot.enabled = active;
            annotationPreviewSegments.forEach(segment => segment.enabled = false);
            annotationPreviewDecoratorStart.enabled = false;
            annotationPreviewDecoratorEnd.enabled = false;
            annotationPreviewFill.enabled = false;
            annotationMeasurementLabels.forEach((label) => {
                label.style.display = 'none';
            });

            if (!active || splat.annotationPoints.length < 2) {
                return;
            }

            const lineMaterial = annotationPreviewSegments[0].render.material as StandardMaterial;
            const fillMaterial = annotationPreviewFill.render.material as StandardMaterial;
            const lineColor = annotationDraft?.lineColor ?? [1, 0.4, 0, 1];
            const boxColor = annotationDraft?.boxColor ?? [1, 0.4, 0, 0.15];
            const lineThickness = Math.max(1, annotationDraft?.lineThickness ?? 2);
            const lineDecorator = annotationDraft?.lineDecorator ?? 'none';
            const showMeasurement = annotationDraft?.showMeasurement === true;
            const measurementUnit = annotationDraft?.measurementUnits ?? 'm';
            setMaterialRgba(lineMaterial, lineColor);
            setMaterialRgba(fillMaterial, boxColor);
            annotationPreviewSegments.forEach(segment => syncRenderOpacity(segment, lineColor[3]));
            syncRenderOpacity(annotationPreviewDecoratorStart, lineColor[3]);
            syncRenderOpacity(annotationPreviewDecoratorEnd, lineColor[3]);
            syncRenderOpacity(annotationPreviewFill, boxColor[3]);

            const worldPoints = splat.annotationPoints.map((point) => {
                const worldPoint = new Vec3();
                splat.worldTransform.transformPoint(point, worldPoint);
                return worldPoint;
            });

            const anchor = splat.annotationLabelPosition ? (() => {
                const worldPoint = new Vec3();
                splat.worldTransform.transformPoint(splat.annotationLabelPosition, worldPoint);
                return worldPoint;
            })() : worldPoints[0];
            const thickness = computeThicknessWorld(anchor, lineThickness);

            if (worldPoints.length === 2) {
                annotationPreviewSegments[0].enabled = true;
                configureSegmentTransform(annotationPreviewSegments[0], worldPoints[0], worldPoints[1], thickness);

                if (lineDecorator !== 'none') {
                    const direction = tmpA.sub2(worldPoints[1], worldPoints[0]);
                    if (lineDecorator === 'box') {
                        annotationPreviewDecoratorStart.render.type = 'box';
                        annotationPreviewDecoratorEnd.render.type = 'box';
                        configureBoxDecorator(annotationPreviewDecoratorStart, worldPoints[0], thickness);
                        configureBoxDecorator(annotationPreviewDecoratorEnd, worldPoints[1], thickness);
                    } else {
                        annotationPreviewDecoratorStart.render.type = 'cone';
                        annotationPreviewDecoratorEnd.render.type = 'cone';
                        configureArrowDecorator(annotationPreviewDecoratorStart, worldPoints[0], direction, thickness, false);
                        configureArrowDecorator(annotationPreviewDecoratorEnd, worldPoints[1], direction, thickness, true);
                    }
                    annotationPreviewDecoratorStart.enabled = true;
                    annotationPreviewDecoratorEnd.enabled = true;
                }

                if (showMeasurement) {
                    tmpA.add2(worldPoints[0], worldPoints[1]).mulScalar(0.5);
                    scene.camera.camera.viewMatrix.transformPoint(tmpA, tmpC);
                    if (tmpC.z >= 0) {
                        annotationMeasurementLabels[0].style.display = 'none';
                        return;
                    }
                    scene.camera.camera.worldToScreen(tmpA, tmpB);
                    const meters = worldPoints[0].distance(worldPoints[1]) * getMeasureScale();
                    annotationMeasurementLabels[0].textContent = `${formatLength(units[measurementUnit].toDisplay(meters))} ${units[measurementUnit].suffix}`;
                    annotationMeasurementLabels[0].style.left = `${tmpB.x}px`;
                    annotationMeasurementLabels[0].style.top = `${tmpB.y}px`;
                    annotationMeasurementLabels[0].style.display = 'block';
                }
                return;
            }

            const [a, b, c] = worldPoints;
            const minX = Math.min(a.x, b.x, c.x);
            const maxX = Math.max(a.x, b.x, c.x);
            const minY = Math.min(a.y, b.y, c.y);
            const maxY = Math.max(a.y, b.y, c.y);
            const minZ = Math.min(a.z, b.z, c.z);
            const maxZ = Math.max(a.z, b.z, c.z);
            const corners = [
                new Vec3(minX, minY, minZ),
                new Vec3(maxX, minY, minZ),
                new Vec3(maxX, minY, maxZ),
                new Vec3(minX, minY, maxZ),
                new Vec3(minX, maxY, minZ),
                new Vec3(maxX, maxY, minZ),
                new Vec3(maxX, maxY, maxZ),
                new Vec3(minX, maxY, maxZ)
            ];
            const edges: [number, number][] = [
                [0, 1], [1, 2], [2, 3], [3, 0],
                [4, 5], [5, 6], [6, 7], [7, 4],
                [0, 4], [1, 5], [2, 6], [3, 7]
            ];

            edges.forEach(([i0, i1], idx) => {
                annotationPreviewSegments[idx].enabled = true;
                configureSegmentTransform(annotationPreviewSegments[idx], corners[i0], corners[i1], thickness);
            });

            annotationPreviewFill.enabled = true;
            annotationPreviewFill.setPosition((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
            annotationPreviewFill.setLocalScale(
                Math.max(1e-4, maxX - minX),
                Math.max(1e-4, maxY - minY),
                Math.max(1e-4, maxZ - minZ)
            );

            if (showMeasurement) {
                const labelPairs: [Vec3, Vec3][] = [
                    [corners[0], corners[1]],
                    [corners[0], corners[3]],
                    [corners[0], corners[4]]
                ];
                labelPairs.forEach(([start, end], idx) => {
                    tmpA.add2(start, end).mulScalar(0.5);
                    scene.camera.camera.viewMatrix.transformPoint(tmpA, tmpC);
                    if (tmpC.z >= 0) {
                        annotationMeasurementLabels[idx].style.display = 'none';
                        return;
                    }
                    scene.camera.camera.worldToScreen(tmpA, tmpB);
                    const meters = start.distance(end) * getMeasureScale();
                    annotationMeasurementLabels[idx].textContent = `${formatLength(units[measurementUnit].toDisplay(meters))} ${units[measurementUnit].suffix}`;
                    annotationMeasurementLabels[idx].style.left = `${tmpB.x}px`;
                    annotationMeasurementLabels[idx].style.top = `${tmpB.y}px`;
                    annotationMeasurementLabels[idx].style.display = 'block';
                });
            }
        };

        gizmo.on('render:update', () => {
            scene.forceRender = true;
        });

        const updateCtrlState = (event: KeyboardEvent) => {
            ctrlPressed = event.ctrlKey;
        };

        gizmo.on('transform:start', () => {
            const activeAxis = (gizmo as typeof gizmo & { _selectedAxis?: string })._selectedAxis;
            snapDraggedPoint = useCreationSnap() && !ctrlPressed && activeAxis === 'xyz';
            events.invoke('pivot').start();
        });

        gizmo.on('transform:move', () => {
            events.invoke('pivot').moveTRS(entity.getLocalPosition(), entity.getLocalRotation(), entity.getLocalScale());
        });

        gizmo.on('transform:end', () => {
            events.invoke('pivot').end();
        });

        events.on('selection.changed', (selection: Splat) => {
            splat = selection;
            settingAnnotationPosition = false;
            if (active) {
                // for now we always deactivate the tool so the current transform handler remains in place
                events.fire('tool.deactivate');
            }
        });

        events.on('annotation.beginSetPosition', () => {
            if (isAnnotationTool && active) {
                settingAnnotationPosition = true;
            }
        });

        events.on('pivot.started', () => {

        });

        events.on('pivot.moved', () => {
            const selection = getSelection();
            if (active && splat && selection >= 0 && selection < getPointCount()) {
                const p = events.invoke('pivot').transform.position;
                mat.invert(splat.worldTransform);
                mat.transformPoint(p, p2);
                if (isAnnotationTool) {
                    setAnnotationHandleLocal(selection, p2);
                } else {
                    splat.measurePoints[selection].copy(p2);
                }
                publishActivePoint();
            }
            scene.forceRender = true;
        });

        events.on('pivot.ended', () => {
            const selection = getSelection();
            if (active && splat && selection >= 0 && selection < getPointCount()) {
                const draggedIndex = selection;
                const targetSplat = splat;
                const finalize = async () => {
                    if (snapDraggedPoint) {
                        getPoint(draggedIndex, p);
                        const draggedPoint = p.clone();
                        scene.camera.worldToScreen(draggedPoint, p2);

                        try {
                            const screenX = p2.x * canvasContainer.dom.clientWidth;
                            const screenY = p2.y * canvasContainer.dom.clientHeight;
                            const result = await scene.camera.intersect(
                                screenX / canvasContainer.dom.clientWidth,
                                screenY / canvasContainer.dom.clientHeight
                            );
                            const snapped = result ?
                                await snapCreatedPoint(result.splat, screenX, screenY, result.position) :
                                draggedPoint;
                            if (draggedIndex < (isAnnotationTool ? ((targetSplat.annotationLabelPosition ? 1 : 0) + targetSplat.annotationPoints.length) : targetSplat.measurePoints.length)) {
                                mat.invert(targetSplat.worldTransform);
                                mat.transformPoint(snapped, p2);
                                if (isAnnotationTool) {
                                    if (draggedIndex === 0) {
                                        targetSplat.annotationLabelPosition = p2.clone();
                                        targetSplat.worldTransform.transformPoint(p2, p);
                                        updatingAnnotationDraft = true;
                                        events.fire('annotation.setDraft', {
                                            position: [p.x, p.y, p.z]
                                        });
                                        updatingAnnotationDraft = false;
                                    } else {
                                        targetSplat.annotationPoints[draggedIndex - 1].copy(p2);
                                    }
                                } else {
                                    targetSplat.measurePoints[draggedIndex].copy(p2);
                                }
                                getPoint(draggedIndex, p);
                                t.set(p, Quat.IDENTITY, Vec3.ONE);
                                events.invoke('pivot').place(t);
                                scene.forceRender = true;
                            }
                        } catch {
                            // keep dragged position if snap fails
                        }
                    }

                    snapDraggedPoint = false;
                    updateVisuals();
                };

                void finalize();
            }
        });

        const origTransform = new Mat4();
        const origP = new Vec3();
        const origR = new Quat();
        const origS = new Vec3();
        const mid = new Vec3();
        let startLen = 0;

        const startScale = () => {
            if (!splat || splat.measurePoints.length < 2) {
                return;
            }

            origTransform.copy(splat.worldTransform);
            origP.copy(splat.entity.getLocalPosition());
            origR.copy(splat.entity.getLocalRotation());
            origS.copy(splat.entity.getLocalScale());

            getPoint(0, p0);
            getPoint(1, p1);
            if (splat.measurePoints.length >= 3) {
                getPoint(2, p2);
                startLen = p0.distance(p1) + p1.distance(p2);
                mid.add2(p0, p2).mulScalar(0.5);
            } else {
                mid.sub2(p1, p0);
                startLen = mid.length();
                mid.mulScalar(0.5).add(p0);
            }
        };

        // position and scale the splat according to the new length
        const applyLength = (newLength: number) => {
            if (!splat || splat.measurePoints.length < 2 || newLength <= 0) {
                return;
            }

            const measureScale = getMeasureScale();
            const unit = getCurrentUnit();
            const rawLength = units[unit].toMeters(newLength) / measureScale;
            const scale = rawLength / startLen;

            // calculate mid point
            p.copy(mid);

            // construct a transform matrix that scales from p by len * 0.5
            mat1.setTranslate(-p.x, -p.y, -p.z);
            mat2.setScale(scale, scale, scale);
            mat3.setTranslate(p.x, p.y, p.z);

            mat.mul2(mat1, origTransform);
            mat.mul2(mat2, mat);
            mat.mul2(mat3, mat);

            mat.getTranslation(p);
            r.setFromMat4(mat);
            mat.getScale(s);

            splat.entity.setLocalPosition(p);
            splat.entity.setLocalRotation(r);
            splat.entity.setLocalScale(s);

            scene.forceRender = true;
        };

        const endScale = () => {
            const top = new EntityTransformOp({
                splat: splat,
                oldt: new Transform(origP, origR, origS),
                newt: new Transform(splat.entity.getLocalPosition(), splat.entity.getLocalRotation(), splat.entity.getLocalScale())
            });

            events.fire('edit.add', top);
            updateVisuals();
        };

        if (lengthInput && lengthUnit) {
            let dragging = false;

            // handle length input updates
            lengthInput.on('slider:mousedown', () => {
                startScale();
                dragging = true;
            });
            lengthInput.on('change', (value) => {
                if (dragging) {
                    applyLength(value);
                } else if (!suppressUI) {
                    startScale();
                    applyLength(value);
                    endScale();
                }
            });
            lengthInput.on('slider:mouseup', () => {
                endScale();
                dragging = false;
            });

            lengthUnit.on('change', () => {
                updateVisuals();
            });
        }

        if (copyButton) {
            copyButton.on('click', () => {
                events.fire('annotation.copy');
            });
        }

        clearButton.on('click', () => {
            if (splat) {
                if (isAnnotationTool) {
                    splat.annotationLabelPosition = null;
                    splat.annotationPoints.length = 0;
                    splat.annotationSelection = -1;
                    updatingAnnotationDraft = true;
                    events.fire('annotation.setDraft', {
                        position: [0, 0, 0]
                    });
                    updatingAnnotationDraft = false;
                } else {
                    splat.measurePoints.length = 0;
                    splat.measureSelection = -1;
                }
                updateVisuals();
            }
        });

        events.on('select.delete', () => {
            const selection = getSelection();
            if (active && splat && selection >= 0 && selection < getPointCount()) {
                if (isAnnotationTool) {
                    if (selection === 0) {
                        splat.annotationLabelPosition = null;
                        updatingAnnotationDraft = true;
                        events.fire('annotation.setDraft', {
                            position: [0, 0, 0]
                        });
                        updatingAnnotationDraft = false;
                    } else {
                        splat.annotationPoints.splice(selection - 1, 1);
                    }
                    splat.annotationSelection = -1;
                } else {
                    splat.measurePoints.splice(selection, 1);
                    splat.measureSelection--;
                }
                updateVisuals();
            }
        });

        const isPrimary = (e: PointerEvent) => {
            return e.pointerType === 'mouse' ? e.button === 0 : e.isPrimary;
        };

        let clicked = false;

        const pointerdown = (e: PointerEvent) => {
            if (!clicked && isPrimary(e)) {
                clicked = true;
            }
        };

        const pointermove = (e: PointerEvent) => {
            clicked = false;
        };

        const setAnnotationLabelFromWorldPoint = (worldPoint: Vec3) => {
            mat.invert(splat.worldTransform);
            mat.transformPoint(worldPoint, p2);
            splat.annotationLabelPosition = p2.clone();
            updatingAnnotationDraft = true;
            events.fire('annotation.setDraft', {
                position: [worldPoint.x, worldPoint.y, worldPoint.z]
            });
            updatingAnnotationDraft = false;
        };

        const addAnnotationPointFromWorldPoint = (worldPoint: Vec3) => {
            mat.invert(splat.worldTransform);
            mat.transformPoint(worldPoint, p);
            splat.annotationSelection = splat.annotationPoints.length + 1;
            splat.annotationPoints.push(p.clone());
            updateVisuals();
        };

        const pointerup = async (e: PointerEvent) => {
            if (splat && clicked && isPrimary(e)) {
                clicked = false;

                if (isAnnotationTool && settingAnnotationPosition) {
                    settingAnnotationPosition = false;
                    const result = await scene.camera.intersect(e.offsetX / canvasContainer.dom.clientWidth, e.offsetY / canvasContainer.dom.clientHeight);
                    if (result) {
                        let worldPoint = result.position.clone();
                        if (useCreationSnap() && !e.ctrlKey) {
                            try {
                                worldPoint = await snapCreatedPoint(result.splat, e.offsetX, e.offsetY, result.position);
                            } catch {
                                // keep raw hit if snap fails
                            }
                        }
                        setAnnotationLabelFromWorldPoint(worldPoint);
                        splat.annotationSelection = 0;
                        updateVisuals();
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }

                let closestIdx = -1;

                // check for intersection with existing point
                for (let i = 0; i < getPointCount(); i++) {
                    getPoint2d(i, p);

                    if (Math.abs(p.x - e.offsetX) < 8 && Math.abs(p.y - e.offsetY) < 8) {
                        closestIdx = i;
                        break;
                    }
                }

                if (closestIdx >= 0) {
                    setSelection(closestIdx);
                    updateVisuals();
                    return;
                }

                if (isAnnotationTool) {
                    if (!splat.annotationLabelPosition) {
                        const result = await scene.camera.intersect(e.offsetX / canvasContainer.dom.clientWidth, e.offsetY / canvasContainer.dom.clientHeight);
                        if (result) {
                            let worldPoint = result.position.clone();
                            if (useCreationSnap() && !e.ctrlKey) {
                                try {
                                    worldPoint = await snapCreatedPoint(result.splat, e.offsetX, e.offsetY, result.position);
                                } catch {
                                }
                            }
                            setAnnotationLabelFromWorldPoint(worldPoint);
                            addAnnotationPointFromWorldPoint(worldPoint);
                            updateVisuals();
                        }
                    } else if (splat.annotationPoints.length < 3) {
                        const result = await scene.camera.intersect(e.offsetX / canvasContainer.dom.clientWidth, e.offsetY / canvasContainer.dom.clientHeight);
                        if (result) {
                            addAnnotationPointFromWorldPoint(result.position);

                            if (useCreationSnap() && !e.ctrlKey) {
                                const insertedIndex = splat.annotationSelection;
                                const targetSplat = splat;
                                void (async () => {
                                    try {
                                        const snapped = await snapCreatedPoint(result.splat, e.offsetX, e.offsetY, result.position);
                                        if (!active || splat !== targetSplat || targetSplat.annotationSelection !== insertedIndex || insertedIndex - 1 >= targetSplat.annotationPoints.length) {
                                            return;
                                        }

                                        mat.invert(targetSplat.worldTransform);
                                        mat.transformPoint(snapped, targetSplat.annotationPoints[insertedIndex - 1]);
                                        updateVisuals();
                                    } catch {
                                    }
                                })();
                            }
                        }
                    }
                } else if (splat.measurePoints.length < 3) {
                    const result = await scene.camera.intersect(e.offsetX / canvasContainer.dom.clientWidth, e.offsetY / canvasContainer.dom.clientHeight);
                    if (result) {
                        mat.invert(splat.worldTransform);
                        mat.transformPoint(result.position, p);
                        splat.measureSelection = splat.measurePoints.length;
                        splat.measurePoints.push(p.clone());
                        updateVisuals();

                        if (useCreationSnap() && !e.ctrlKey) {
                            const insertedIndex = splat.measureSelection;
                            const targetSplat = splat;
                            void (async () => {
                                try {
                                    const snapped = await snapCreatedPoint(result.splat, e.offsetX, e.offsetY, result.position);
                                    if (!active || splat !== targetSplat || targetSplat.measureSelection !== insertedIndex || insertedIndex >= targetSplat.measurePoints.length) {
                                        return;
                                    }

                                    mat.invert(targetSplat.worldTransform);
                                    mat.transformPoint(snapped, targetSplat.measurePoints[insertedIndex]);
                                    updateVisuals();
                                } catch {
                                    // keep the initially created point if snapping fails
                                }
                            })();
                        }
                    }
                }

                e.preventDefault();
                e.stopPropagation();
            }
        };

        events.on('postrender', () => {
            if (isAnnotationTool && active && splat) {
                updateAnnotationPreview();
            }

            line.setAttribute('visibility', 'hidden');
            line2.setAttribute('visibility', 'hidden');
            lineStart.setAttribute('visibility', 'hidden');
            lineMid.setAttribute('visibility', 'hidden');
            lineEnd.setAttribute('visibility', 'hidden');
            lineExtra.setAttribute('visibility', 'hidden');

            if (!(active && splat)) {
                return;
            }

            if (isAnnotationTool) {
                if (splat.annotationLabelPosition) {
                    getPoint2d(0, p);
                    lineStart.setAttribute('cx', p.x.toString());
                    lineStart.setAttribute('cy', p.y.toString());
                    lineStart.setAttribute('visibility', 'visible');
                }

                for (let i = 0; i < splat.annotationPoints.length; i++) {
                    getPoint2d(i + 1, p);
                    const x = p.x.toString();
                    const y = p.y.toString();
                    const handle = i === 0 ? lineMid : (i === 1 ? lineEnd : lineExtra);
                    handle.setAttribute('cx', x);
                    handle.setAttribute('cy', y);
                    handle.setAttribute('visibility', 'visible');

                    if (i === 0 && splat.annotationPoints.length > 1) {
                        line.setAttribute('x1', x);
                        line.setAttribute('y1', y);
                    } else if (i === 1) {
                        line.setAttribute('x2', x);
                        line.setAttribute('y2', y);
                        if (splat.annotationPoints.length > 2) {
                            line2.setAttribute('x1', x);
                            line2.setAttribute('y1', y);
                        }
                    } else if (i === 2) {
                        line2.setAttribute('x2', x);
                        line2.setAttribute('y2', y);
                    }
                }

                line.setAttribute('visibility', splat.annotationPoints.length > 1 ? 'visible' : 'hidden');
                line2.setAttribute('visibility', splat.annotationPoints.length > 2 ? 'visible' : 'hidden');
                return;
            }

            line.setAttribute('visibility', splat.measurePoints.length > 1 ? 'visible' : 'hidden');
            line2.setAttribute('visibility', splat.measurePoints.length > 2 ? 'visible' : 'hidden');

            for (let i = 0; i < 3; i++) {
                if (i < splat.measurePoints.length) {
                    getPoint2d(i, p);

                    const x = p.x.toString();
                    const y = p.y.toString();

                    if (i === 0) {
                        line.setAttribute('x1', x);
                        line.setAttribute('y1', y);
                        lineStart.setAttribute('cx', x);
                        lineStart.setAttribute('cy', y);
                        lineStart.setAttribute('visibility', 'visible');
                    } else if (i === 1) {
                        line.setAttribute('x2', x);
                        line.setAttribute('y2', y);
                        line2.setAttribute('x1', x);
                        line2.setAttribute('y1', y);
                        lineMid.setAttribute('cx', x);
                        lineMid.setAttribute('cy', y);
                        lineMid.setAttribute('visibility', 'visible');
                    } else if (i === 2) {
                        line2.setAttribute('x2', x);
                        line2.setAttribute('y2', y);
                        lineEnd.setAttribute('cx', x);
                        lineEnd.setAttribute('cy', y);
                        lineEnd.setAttribute('visibility', 'visible');
                    }
                }
            }
        });

        if (isAnnotationTool) {
            events.on('annotation.draftChanged', (draft: {
                position: [number, number, number],
                lineColor?: [number, number, number, number],
                boxColor?: [number, number, number, number],
                lineThickness?: number,
                lineDecorator?: 'none' | 'box' | 'arrowheads'
            }) => {
                annotationDraft = draft;
                if (!active || !splat || updatingAnnotationDraft || !draft?.position) {
                    updateAnnotationPreview();
                    return;
                }
                p.set(draft.position[0], draft.position[1], draft.position[2]);
                mat.invert(splat.worldTransform);
                mat.transformPoint(p, p2);
                splat.annotationLabelPosition = p2.clone();
                updateVisuals();
            });
        }

        const updateGizmoSize = () => {
            const { camera, canvas } = scene;
            if (camera.ortho) {
                gizmo.size = 1125 / canvas.clientHeight;
            } else {
                gizmo.size = 1200 / Math.max(canvas.clientWidth, canvas.clientHeight);
            }
        };
        updateGizmoSize();
        events.on('camera.resize', updateGizmoSize);
        events.on('camera.ortho', updateGizmoSize);
        events.on('view.measureScale', () => {
            if (active) {
                updateVisuals();
            }
        });
        events.on('splat.stateChanged', (changedSplat: Splat) => {
            positionsCache.delete(changedSplat);
        });
        events.on('splat.positionsChanged', (changedSplat: Splat) => {
            positionsCache.delete(changedSplat);
        });

        this.activate = () => {
            active = true;
            updateVisuals();
            canvasContainer.dom.addEventListener('pointerdown', pointerdown);
            canvasContainer.dom.addEventListener('pointermove', pointermove);
            canvasContainer.dom.addEventListener('pointerup', pointerup, true);
            window.addEventListener('keydown', updateCtrlState);
            window.addEventListener('keyup', updateCtrlState);
            selectToolbar.hidden = false;
            parent.style.display = 'block';
            parent.classList.add('noevents');
            svg.classList.remove('hidden');
            if (annotationPreviewRoot) {
                annotationPreviewRoot.enabled = true;
            }

            events.fire('transformHandler.push', transformHandler);
        };

        this.deactivate = () => {
            active = false;
            snapDraggedPoint = false;
            settingAnnotationPosition = false;
            ctrlPressed = false;
            updateVisuals();
            canvasContainer.dom.removeEventListener('pointerdown', pointerdown);
            canvasContainer.dom.removeEventListener('pointermove', pointermove);
            canvasContainer.dom.removeEventListener('pointerup', pointerup);
            window.removeEventListener('keydown', updateCtrlState);
            window.removeEventListener('keyup', updateCtrlState);
            selectToolbar.hidden = true;
            parent.style.display = 'none';
            parent.classList.remove('noevents');
            svg.classList.add('hidden');
            if (annotationPreviewRoot) {
                annotationPreviewRoot.enabled = false;
            }
            annotationMeasurementLabels.forEach((label) => {
                label.style.display = 'none';
            });

            events.fire('transformHandler.pop');
        };
    }
}

export { CalloutTool };
