import { Button, Container, Label } from '@playcanvas/pcui';
import { BLEND_NONE, BLEND_NORMAL, Color, Entity, Mat4, Quat, StandardMaterial, TranslateGizmo, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { Scene } from '../scene';
import { Splat } from '../splat';
import { State } from '../splat-state';
import { Transform } from '../transform';

const mat = new Mat4();
const p = new Vec3();
const p0 = new Vec3();
const p1 = new Vec3();
const p2 = new Vec3();
const q = new Quat();
const t = new Transform();
const tmpA = new Vec3();
const tmpB = new Vec3();
const tmpC = new Vec3();

type AnnotationData = {
    position: [number, number, number],
    title: string,
    text: string,
    textColor: [number, number, number, number],
    msgBoxColor: [number, number, number, number],
    lineColor: [number, number, number, number],
    lineDecorator: 'none' | 'box' | 'arrowheads',
    lineThickness: number,
    boxColor: [number, number, number, number],
    showMeasurement: boolean,
    measurementUnits: 'm' | 'ft' | 'in' | 'cm',
    extras?: any,
    camera?: {
        initial: {
            position: [number, number, number],
            target: [number, number, number],
            fov: number
        }
    },
    kind?: 'point' | 'line' | 'box',
    points?: [number, number, number][]
};

class MeasureTransformHandler {
    activate() {}
    deactivate() {}
}

class CalloutTool {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, scene: Scene, parent: HTMLElement, canvasContainer: Container) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden', 'measure-tool-svg');
        svg.id = 'annotation-tool-svg';
        parent.appendChild(svg);

        const ns = svg.namespaceURI;
        const defs = document.createElementNS(ns, 'defs');
        const line = document.createElementNS(ns, 'line') as SVGLineElement;
        line.id = 'annotation-line';
        defs.appendChild(line);

        const lineBottom = document.createElementNS(ns, 'use') as SVGUseElement;
        lineBottom.classList.add('measure-line-bottom');
        lineBottom.setAttribute('href', `#${line.id}`);

        const lineTop = document.createElementNS(ns, 'use') as SVGUseElement;
        lineTop.classList.add('measure-line-top');
        lineTop.setAttribute('href', `#${line.id}`);

        const line2 = document.createElementNS(ns, 'line') as SVGLineElement;
        line2.id = 'annotation-line-2';
        defs.appendChild(line2);

        const line2Bottom = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Bottom.classList.add('measure-line-bottom');
        line2Bottom.setAttribute('href', `#${line2.id}`);

        const line2Top = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Top.classList.add('measure-line-top');
        line2Top.setAttribute('href', `#${line2.id}`);

        const lineStart = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineStart.classList.add('measure-line-point');

        const lineMid = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineMid.classList.add('measure-line-point');

        const lineEnd = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineEnd.classList.add('measure-line-point');

        const lineExtra = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineExtra.classList.add('measure-line-point');

        svg.append(defs, lineBottom, lineTop, line2Bottom, line2Top, lineStart, lineMid, lineEnd, lineExtra);

        const prevButton = new Button({ class: 'select-toolbar-button', text: '<' });
        const statusLabel = new Label({ text: 'callout 0/0' });
        const newButton = new Button({ class: 'select-toolbar-button', text: 'New' });
        const cloneButton = new Button({ class: 'select-toolbar-button', text: 'Clone' });
        const deleteButton = new Button({ class: 'select-toolbar-button', text: 'Delete' });
        const clearButton = new Button({ class: 'select-toolbar-button', text: 'Clear Path' });
        const exportButton = new Button({ class: 'select-toolbar-button', text: 'Export' });
        const nextButton = new Button({ class: 'select-toolbar-button', text: '>' });

        const selectToolbar = new Container({
            class: 'select-toolbar',
            hidden: true
        });

        selectToolbar.dom.addEventListener('pointerdown', (e) => e.stopPropagation());
        selectToolbar.append(prevButton);
        selectToolbar.append(statusLabel);
        selectToolbar.append(newButton);
        selectToolbar.append(cloneButton);
        selectToolbar.append(deleteButton);
        selectToolbar.append(clearButton);
        selectToolbar.append(exportButton);
        selectToolbar.append(nextButton);
        canvasContainer.append(selectToolbar);

        const gizmo = new TranslateGizmo(scene.camera.camera, scene.gizmoLayer);
        const entity = new Entity('calloutGizmoPivot');
        const transformHandler = new MeasureTransformHandler();
        const annotationPreviewRoot = new Entity('annotationPreviewRoot');
        const annotationPreviewSegments = [] as Entity[];
        const annotationPreviewDecoratorStart = new Entity('annotationPreviewDecoratorStart');
        const annotationPreviewDecoratorEnd = new Entity('annotationPreviewDecoratorEnd');
        const annotationPreviewFill = new Entity('annotationPreviewFill');
        const annotationMeasurementLabels = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
        const annotationTooltip = document.createElement('div');
        const annotationTooltipTitle = document.createElement('div');
        const annotationTooltipText = document.createElement('div');

        let active = false;
        let splat: Splat | null = null;
        let annotationSelection = -1;
        let annotationState: {
            count: number,
            index: number,
            current: AnnotationData | null
        } = {
            count: 0,
            index: -1,
            current: null
        };
        const positionsCache = new WeakMap<Splat, Float32Array>();
        const screenSearchRadius = 24;
        const densityRadius = 0.35;
        const zBinSize = 0.15;
        const maxSnapOffset = 2;
        const minClusterCount = 2;
        let ctrlPressed = false;
        let snapDraggedPoint = false;
        let zoomAfterNavigation = false;
        let draggingHandle = false;

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
            return material;
        };

        const setMaterialRgba = (material: StandardMaterial, rgba: [number, number, number, number]) => {
            material.diffuse.set(rgba[0], rgba[1], rgba[2]);
            material.emissive.set(rgba[0], rgba[1], rgba[2]);
            material.opacity = rgba[3];
            if (rgba[3] < 1) {
                material.blendType = BLEND_NORMAL;
                material.depthWrite = false;
            } else {
                material.blendType = BLEND_NONE;
                material.depthWrite = true;
            }
            material.update();
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
            camera.viewMatrix.transformPoint(anchor, tmpA);
            const depth = Math.max(0.1, -tmpA.z);
            const { width, height } = scene.app.graphicsDevice.clientRect;
            const fovRad = camera.fov * Math.PI / 180;
            const worldSpan = 2 * depth * Math.tan(fovRad * 0.5);
            const worldPerPixel = camera.horizontalFov ? worldSpan / width : worldSpan / height;
            return Math.max(0.001, lineThickness * worldPerPixel);
        };

        const formatLength = (value: number) => {
            return value >= 100 ? value.toFixed(1) : value.toFixed(2);
        };

        const units = {
            m: { toDisplay: (meters: number) => meters, suffix: 'm' },
            cm: { toDisplay: (meters: number) => meters * 100, suffix: 'cm' },
            ft: { toDisplay: (meters: number) => meters * 3.280839895, suffix: 'ft' },
            in: { toDisplay: (meters: number) => meters * 39.37007874, suffix: 'in' }
        } as const;

        const getMeasureScale = () => {
            const value = events.invoke('view.measureScale');
            return Number.isFinite(value) && value > 0 ? value : 1;
        };

        const edgeMaterial = createPrimitiveMaterial([1, 0.4, 0, 1]);
        const fillMaterial = createPrimitiveMaterial([1, 0.4, 0, 0.15]);
        for (let i = 0; i < 12; i++) {
            const segmentEntity = new Entity(`annotationPreviewSegment${i}`);
            segmentEntity.addComponent('render', {
                type: 'box',
                material: edgeMaterial
            });
            annotationPreviewRoot.addChild(segmentEntity);
            annotationPreviewSegments.push(segmentEntity);
        }
        annotationPreviewDecoratorStart.addComponent('render', { type: 'box', material: edgeMaterial });
        annotationPreviewDecoratorEnd.addComponent('render', { type: 'box', material: edgeMaterial });
        annotationPreviewFill.addComponent('render', { type: 'box', material: fillMaterial });
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
        annotationTooltip.className = 'annotation-preview-tooltip';
        annotationTooltipTitle.className = 'annotation-preview-tooltip-title';
        annotationTooltipText.className = 'annotation-preview-tooltip-text';
        annotationTooltip.appendChild(annotationTooltipTitle);
        annotationTooltip.appendChild(annotationTooltipText);
        annotationTooltip.style.display = 'none';
        canvasContainer.dom.appendChild(annotationTooltip);

        const currentAnnotation = () => annotationState.current;
        const hasLabel = () => !!currentAnnotation() && Array.isArray(currentAnnotation()!.points);
        const getPointCount = () => {
            const annotation = currentAnnotation();
            return annotation && hasLabel() ? 1 + (annotation.points?.length ?? 0) : 0;
        };
        const getSelection = () => annotationSelection;
        const setSelection = (value: number) => {
            annotationSelection = value;
        };

        const publishActivePoint = () => {
            const selection = getSelection();
            if (active && selection >= 0 && selection < getPointCount()) {
                getPoint(selection, p);
                events.fire('measure.activePoint', { x: p.x, y: p.y, z: p.z });
            } else {
                events.fire('measure.activePoint', null);
            }
        };

        const updateToolbarState = () => {
            statusLabel.text = `callout ${annotationState.count === 0 ? 0 : annotationState.index + 1}/${annotationState.count}`;
            prevButton.enabled = annotationState.index > 0;
            nextButton.enabled = annotationState.index >= 0 && annotationState.index < annotationState.count - 1;
            cloneButton.enabled = annotationState.index >= 0;
            deleteButton.enabled = annotationState.index >= 0;
            clearButton.enabled = annotationState.index >= 0;
        };

        const getPoint = (index: number, result: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation) {
                result.set(0, 0, 0);
                return;
            }
            if (index === 0) {
                result.set(annotation.position[0], annotation.position[1], annotation.position[2]);
            } else {
                const point = annotation.points?.[index - 1];
                if (!point) {
                    result.set(0, 0, 0);
                    return;
                }
                result.set(point[0], point[1], point[2]);
            }
        };

        const getPoint2d = (index: number, result: Vec3) => {
            getPoint(index, result);
            scene.camera.worldToScreen(result, result);
            result.x *= canvasContainer.dom.clientWidth;
            result.y *= canvasContainer.dom.clientHeight;
        };

        const setAnnotationLabel = (worldPoint: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation) {
                return;
            }
            events.fire('annotation.setGeometry', {
                position: [worldPoint.x, worldPoint.y, worldPoint.z],
                points: annotation.points ?? []
            });
        };

        const setAnnotationLabelLocal = (worldPoint: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation) {
                return;
            }
            annotation.position = [worldPoint.x, worldPoint.y, worldPoint.z];
        };

        const setAnnotationPathPoint = (index: number, worldPoint: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation || !annotation.points) {
                return;
            }
            const points = annotation.points.map(point => [...point] as [number, number, number]);
            points[index - 1] = [worldPoint.x, worldPoint.y, worldPoint.z];
            events.fire('annotation.setGeometry', {
                position: annotation.position,
                points
            });
        };

        const setAnnotationPathPointLocal = (index: number, worldPoint: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation || !annotation.points) {
                return;
            }
            annotation.points[index - 1] = [worldPoint.x, worldPoint.y, worldPoint.z];
            annotation.kind = annotation.points.length === 1 ? 'point' : (annotation.points.length === 2 ? 'line' : 'box');
        };

        const addAnnotationPoint = (worldPoint: Vec3) => {
            const annotation = currentAnnotation();
            if (!annotation) {
                return;
            }
            const points = [...(annotation.points ?? [])].map(point => [...point] as [number, number, number]);
            points.push([worldPoint.x, worldPoint.y, worldPoint.z]);
            events.fire('annotation.setGeometry', {
                position: annotation.position,
                points
            });
            annotationSelection = points.length;
        };

        const removeSelectedPoint = () => {
            const annotation = currentAnnotation();
            if (!annotation || annotationSelection < 1 || !annotation.points) {
                return;
            }
            const points = annotation.points.map(point => [...point] as [number, number, number]);
            points.splice(annotationSelection - 1, 1);
            events.fire('annotation.setGeometry', {
                position: annotation.position,
                points
            });
            annotationSelection = -1;
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
                if (dx * dx + dy * dy <= screenSearchRadius * screenSearchRadius) {
                    p.sub2(p2, cameraPosition);
                    const depth = p.dot(cameraForward);
                    if (depth > 0) {
                        candidates.push({ x: p2.x, y: p2.y, z: p2.z, depth });
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
                    if (refinedBest.count >= minClusterCount && Math.abs(fallback.z - snappedZ) <= maxSnapOffset) {
                        return new Vec3(anchorX, anchorY, snappedZ);
                    }
                }
            }

            if (!clampToFallback) {
                return new Vec3(anchorX, anchorY, anchorZ);
            }

            if (bestBucket.count >= minClusterCount && Math.abs(fallback.z - anchorZ) <= maxSnapOffset) {
                return new Vec3(anchorX, anchorY, anchorZ);
            }

            return fallback;
        };

        const updateAnnotationPreview = () => {
            annotationPreviewRoot.enabled = active;
            annotationPreviewSegments.forEach(segment => segment.enabled = false);
            annotationPreviewDecoratorStart.enabled = false;
            annotationPreviewDecoratorEnd.enabled = false;
            annotationPreviewFill.enabled = false;
            annotationMeasurementLabels.forEach((label) => {
                label.style.display = 'none';
            });
            annotationTooltip.style.display = 'none';

            const annotation = currentAnnotation();
            if (!active || !annotation) {
                return;
            }

            tmpA.set(annotation.position[0], annotation.position[1], annotation.position[2]);
            scene.camera.camera.viewMatrix.transformPoint(tmpA, tmpC);
            if (tmpC.z < 0) {
                scene.camera.camera.worldToScreen(tmpA, tmpB);
                const margin = 8;
                const arrowOffset = 25;
                annotationTooltipTitle.textContent = annotation.title ?? '';
                annotationTooltipText.textContent = annotation.text ?? '';
                annotationTooltip.style.setProperty('--annotation-text', `rgba(${Math.round(annotation.textColor[0] * 255)}, ${Math.round(annotation.textColor[1] * 255)}, ${Math.round(annotation.textColor[2] * 255)}, ${annotation.textColor[3]})`);
                annotationTooltip.style.setProperty('--annotation-bg', `rgba(${Math.round(annotation.msgBoxColor[0] * 255)}, ${Math.round(annotation.msgBoxColor[1] * 255)}, ${Math.round(annotation.msgBoxColor[2] * 255)}, ${annotation.msgBoxColor[3]})`);
                annotationTooltip.style.visibility = 'visible';
                annotationTooltip.style.opacity = '1';
                annotationTooltip.style.display = 'block';
                const tw = annotationTooltip.offsetWidth;
                const th = annotationTooltip.offsetHeight;
                const vw = window.innerWidth;
                const vh = window.innerHeight;
                let left = tmpB.x + arrowOffset;
                let top = tmpB.y - th / 2;
                let flipped = false;

                if (left + tw > vw - margin) {
                    left = tmpB.x - arrowOffset - tw;
                    flipped = true;
                }

                left = Math.max(margin, Math.min(left, vw - tw - margin));
                top = Math.max(margin, Math.min(top, vh - th - margin));
                const arrowY = Math.max(16, Math.min(tmpB.y - top, th - 16));
                annotationTooltip.style.setProperty('--arrow-top', `${arrowY}px`);
                annotationTooltip.classList.toggle('arrow-right', !flipped);
                annotationTooltip.classList.toggle('arrow-left', flipped);
                annotationTooltip.style.left = `${left}px`;
                annotationTooltip.style.top = `${top}px`;
            }

            if (!annotation.points || annotation.points.length < 2) {
                return;
            }

            const lineMaterial = annotationPreviewSegments[0].render.material as StandardMaterial;
            const fillMaterial = annotationPreviewFill.render.material as StandardMaterial;
            const lineColor = annotation.lineColor;
            const boxColor = annotation.boxColor;
            const lineThickness = Math.max(1, annotation.lineThickness);
            const lineDecorator = annotation.lineDecorator;
            const showMeasurement = annotation.showMeasurement === true;
            const measurementUnit = annotation.measurementUnits ?? 'm';
            setMaterialRgba(lineMaterial, lineColor);
            setMaterialRgba(fillMaterial, boxColor);

            const worldPoints = annotation.points.map(point => new Vec3(point[0], point[1], point[2]));
            const anchor = new Vec3(annotation.position[0], annotation.position[1], annotation.position[2]);
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
                    if (tmpC.z < 0) {
                        scene.camera.camera.worldToScreen(tmpA, tmpB);
                        const meters = worldPoints[0].distance(worldPoints[1]) * getMeasureScale();
                        annotationMeasurementLabels[0].textContent = `${formatLength(units[measurementUnit].toDisplay(meters))} ${units[measurementUnit].suffix}`;
                        annotationMeasurementLabels[0].style.left = `${tmpB.x}px`;
                        annotationMeasurementLabels[0].style.top = `${tmpB.y}px`;
                        annotationMeasurementLabels[0].style.display = 'block';
                    }
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
                    if (tmpC.z < 0) {
                        scene.camera.camera.worldToScreen(tmpA, tmpB);
                        const meters = start.distance(end) * getMeasureScale();
                        annotationMeasurementLabels[idx].textContent = `${formatLength(units[measurementUnit].toDisplay(meters))} ${units[measurementUnit].suffix}`;
                        annotationMeasurementLabels[idx].style.left = `${tmpB.x}px`;
                        annotationMeasurementLabels[idx].style.top = `${tmpB.y}px`;
                        annotationMeasurementLabels[idx].style.display = 'block';
                    }
                });
            }
        };

        const updateVisuals = () => {
            gizmo.detach();
            const selection = getSelection();
            if (active && selection >= 0 && selection < getPointCount()) {
                getPoint(selection, p);
                t.set(p, q.set(0, 0, 0, 1), Vec3.ONE);
                events.invoke('pivot').place(t);
                entity.setLocalPosition(p);
                gizmo.attach(entity);
            }
            publishActivePoint();
            updateToolbarState();
            updateAnnotationPreview();
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
            draggingHandle = true;
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
        });

        events.on('annotation.selectLabel', () => {
            if (active) {
                annotationSelection = currentAnnotation() ? 0 : -1;
                updateVisuals();
            }
        });

        events.on('pivot.moved', () => {
            const selection = getSelection();
            if (active && selection >= 0 && selection < getPointCount()) {
                const pivot = events.invoke('pivot').transform.position as Vec3;
                if (selection === 0) {
                    setAnnotationLabelLocal(pivot);
                } else {
                    setAnnotationPathPointLocal(selection, pivot);
                }
                publishActivePoint();
                updateAnnotationPreview();
            }
            scene.forceRender = true;
        });

        events.on('pivot.ended', () => {
            const selection = getSelection();
            if (!active || selection < 0 || selection >= getPointCount()) {
                return;
            }

            const finalize = async () => {
                if (snapDraggedPoint) {
                    getPoint(selection, p);
                    const draggedPoint = p.clone();
                    scene.camera.worldToScreen(draggedPoint, p2);
                    const screenX = p2.x * canvasContainer.dom.clientWidth;
                    const screenY = p2.y * canvasContainer.dom.clientHeight;
                    const result = await scene.camera.intersect(
                        screenX / canvasContainer.dom.clientWidth,
                        screenY / canvasContainer.dom.clientHeight
                    );
                    const snapped = result ? await snapCreatedPoint(result.splat, screenX, screenY, result.position) : draggedPoint;
                    if (selection === 0) {
                        setAnnotationLabelLocal(snapped);
                        setAnnotationLabel(snapped);
                    } else {
                        setAnnotationPathPointLocal(selection, snapped);
                        setAnnotationPathPoint(selection, snapped);
                    }
                    getPoint(selection, p);
                    t.set(p, q.set(0, 0, 0, 1), Vec3.ONE);
                    events.invoke('pivot').place(t);
                    scene.forceRender = true;
                } else {
                    const annotation = currentAnnotation();
                    if (annotation) {
                        events.fire('annotation.setGeometry', {
                            position: annotation.position,
                            points: annotation.points ?? []
                        });
                    }
                }

                snapDraggedPoint = false;
                draggingHandle = false;
                updateVisuals();
            };

            void finalize();
        });

        events.on('annotations.stateChanged', (state: { count: number, index: number, current: AnnotationData | null }) => {
            annotationState = state;
            if (annotationSelection >= getPointCount()) {
                annotationSelection = -1;
            }
            if (zoomAfterNavigation) {
                zoomAfterNavigation = false;
                const initial = state.current?.camera?.initial;
                if (initial) {
                    events.fire('camera.setPose', {
                        position: new Vec3(initial.position[0], initial.position[1], initial.position[2]),
                        target: new Vec3(initial.target[0], initial.target[1], initial.target[2]),
                        fov: initial.fov
                    });
                }
            }
            if (draggingHandle) {
                return;
            }
            updateVisuals();
        });

        events.on('select.delete', () => {
            if (active && annotationSelection > 0) {
                removeSelectedPoint();
            }
        });

        prevButton.on('click', () => {
            annotationSelection = -1;
            zoomAfterNavigation = true;
            events.fire('annotation.prev');
        });
        nextButton.on('click', () => {
            annotationSelection = -1;
            zoomAfterNavigation = true;
            events.fire('annotation.next');
        });
        newButton.on('click', () => {
            annotationSelection = -1;
            events.fire('annotation.new');
        });
        cloneButton.on('click', () => {
            annotationSelection = -1;
            events.fire('annotation.cloneCurrent');
        });
        deleteButton.on('click', () => {
            annotationSelection = -1;
            events.fire('annotation.deleteCurrent');
        });
        clearButton.on('click', () => {
            annotationSelection = -1;
            events.fire('annotation.clearPath');
        });
        exportButton.on('click', () => {
            void events.invoke('scene.export', 'config');
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

        const pointerup = async (e: PointerEvent) => {
            if (!clicked || !isPrimary(e)) {
                return;
            }
            clicked = false;

            if (!currentAnnotation()) {
                events.fire('annotation.new');
            }
            const annotation = currentAnnotation();
            if (!annotation) {
                return;
            }

            for (let i = 0; i < getPointCount(); i++) {
                getPoint2d(i, p);
                if (Math.abs(p.x - e.offsetX) < 8 && Math.abs(p.y - e.offsetY) < 8) {
                    setSelection(i);
                    updateVisuals();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }

            const result = await scene.camera.intersect(e.offsetX / canvasContainer.dom.clientWidth, e.offsetY / canvasContainer.dom.clientHeight);
            if (!result) {
                return;
            }

            const createSnappedWorld = async () => {
                if (useCreationSnap() && !e.ctrlKey) {
                    try {
                        return await snapCreatedPoint(result.splat, e.offsetX, e.offsetY, result.position);
                    } catch {
                        return result.position.clone();
                    }
                }
                return result.position.clone();
            };

            const points = annotation.points ?? [];
            if (points.length === 0) {
                const worldPoint = await createSnappedWorld();
                setAnnotationLabel(worldPoint);
                addAnnotationPoint(worldPoint);
                updateVisuals();
            } else if (points.length < 3) {
                addAnnotationPoint(result.position);
                updateVisuals();
                if (useCreationSnap() && !e.ctrlKey) {
                    const insertedIndex = annotationSelection;
                    void (async () => {
                        const snapped = await createSnappedWorld();
                        if (!active || insertedIndex !== annotationSelection) {
                            return;
                        }
                        setAnnotationPathPoint(insertedIndex, snapped);
                        updateVisuals();
                    })();
                }
            }

            e.preventDefault();
            e.stopPropagation();
        };

        events.on('postrender', () => {
            if (active) {
                updateAnnotationPreview();
            }

            line.setAttribute('visibility', 'hidden');
            line2.setAttribute('visibility', 'hidden');
            lineStart.setAttribute('visibility', 'hidden');
            lineMid.setAttribute('visibility', 'hidden');
            lineEnd.setAttribute('visibility', 'hidden');
            lineExtra.setAttribute('visibility', 'hidden');

            if (!active || !currentAnnotation() || !hasLabel()) {
                return;
            }

            getPoint2d(0, p);
            lineStart.setAttribute('cx', p.x.toString());
            lineStart.setAttribute('cy', p.y.toString());
            lineStart.setAttribute('visibility', 'visible');

            const points = currentAnnotation()!.points ?? [];
            const showConstructionPolyline = points.length < 3;
            for (let i = 0; i < points.length; i++) {
                getPoint2d(i + 1, p);
                const x = p.x.toString();
                const y = p.y.toString();
                const handle = i === 0 ? lineMid : (i === 1 ? lineEnd : lineExtra);
                handle.setAttribute('cx', x);
                handle.setAttribute('cy', y);
                handle.setAttribute('visibility', 'visible');

                if (i === 0 && points.length > 1) {
                    line.setAttribute('x1', x);
                    line.setAttribute('y1', y);
                } else if (i === 1) {
                    line.setAttribute('x2', x);
                    line.setAttribute('y2', y);
                    if (points.length > 2) {
                        line2.setAttribute('x1', x);
                        line2.setAttribute('y1', y);
                    }
                } else if (i === 2) {
                    line2.setAttribute('x2', x);
                    line2.setAttribute('y2', y);
                }
            }

            line.setAttribute('visibility', showConstructionPolyline && points.length > 1 ? 'visible' : 'hidden');
            line2.setAttribute('visibility', showConstructionPolyline && points.length > 2 ? 'visible' : 'hidden');
        });

        const updateGizmoSize = () => {
            const { camera, canvas } = scene;
            gizmo.size = camera.ortho ? 1125 / canvas.clientHeight : 1200 / Math.max(canvas.clientWidth, canvas.clientHeight);
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
            splat = events.invoke('selection') as Splat | null;
            annotationState = events.invoke('annotations.state') as typeof annotationState;
            const initial = annotationState.current?.camera?.initial;
            if (initial) {
                events.fire('camera.setPose', {
                    position: new Vec3(initial.position[0], initial.position[1], initial.position[2]),
                    target: new Vec3(initial.target[0], initial.target[1], initial.target[2]),
                    fov: initial.fov
                });
            }
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
            annotationPreviewRoot.enabled = true;
            events.fire('transformHandler.push', transformHandler);
        };

        this.deactivate = () => {
            active = false;
            snapDraggedPoint = false;
            ctrlPressed = false;
            annotationSelection = -1;
            draggingHandle = false;
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
            annotationPreviewRoot.enabled = false;
            annotationMeasurementLabels.forEach((label) => {
                label.style.display = 'none';
            });
            annotationTooltip.style.display = 'none';
            events.fire('transformHandler.pop');
        };
    }
}

export { CalloutTool };
