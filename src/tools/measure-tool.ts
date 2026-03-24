import { Button, Container, Label, NumericInput, SelectInput } from '@playcanvas/pcui';
import { Entity, Mat4, Quat, TranslateGizmo, Vec3 } from 'playcanvas';

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

class MeasureTransformHandler {
    activate() {}
    deactivate() {}
}

class MeasureTool {
    activate: () => void;
    deactivate: () => void;

    constructor(events: Events, scene: Scene, parent: HTMLElement, canvasContainer: Container) {
        // create svg
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('tool-svg', 'hidden');
        svg.id = 'measure-tool-svg';
        parent.appendChild(svg);

        const ns = svg.namespaceURI;

        // create defs node
        const defs = document.createElementNS(ns, 'defs');

        // create line element
        const line = document.createElementNS(ns, 'line') as SVGLineElement;
        line.id = 'measure-line';
        defs.appendChild(line);

        const lineBottom = document.createElementNS(ns, 'use') as SVGUseElement;
        lineBottom.id = 'measure-line-bottom';
        lineBottom.setAttribute('href', '#measure-line');

        const lineTop = document.createElementNS(ns, 'use') as SVGUseElement;
        lineTop.id = 'measure-line-top';
        lineTop.setAttribute('href', '#measure-line');

        const line2 = document.createElementNS(ns, 'line') as SVGLineElement;
        line2.id = 'measure-line-2';
        defs.appendChild(line2);

        const line2Bottom = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Bottom.id = 'measure-line-2-bottom';
        line2Bottom.setAttribute('href', '#measure-line-2');

        const line2Top = document.createElementNS(ns, 'use') as SVGUseElement;
        line2Top.id = 'measure-line-2-top';
        line2Top.setAttribute('href', '#measure-line-2');

        // create line ends
        const lineStart = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineStart.id = 'measure-line-start';

        const lineMid = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineMid.id = 'measure-line-mid';

        const lineEnd = document.createElementNS(ns, 'circle') as SVGCircleElement;
        lineEnd.id = 'measure-line-end';

        svg.appendChild(defs);
        svg.appendChild(lineBottom);
        svg.appendChild(lineTop);
        svg.appendChild(line2Bottom);
        svg.appendChild(line2Top);
        svg.appendChild(lineStart);
        svg.appendChild(lineMid);
        svg.appendChild(lineEnd);

        // ui
        const lengthLabel = new Label({
            text: localize('measure.length')
        });

        const lengthInput = new NumericInput({
            width: 90,
            placeholder: 'm',
            precision: 2,
            min: 0.0001,
            value: 0
        });

        const lengthUnit = new SelectInput({
            class: 'measure-unit-select',
            defaultValue: 'm',
            options: [
                { v: 'm', t: 'm' },
                { v: 'cm', t: 'cm' },
                { v: 'ft', t: 'ft' },
                { v: 'in', t: 'in' }
            ]
        });
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

        selectToolbar.append(lengthLabel);
        selectToolbar.append(lengthInput);
        selectToolbar.append(lengthUnit);
        selectToolbar.append(clearButton);
        canvasContainer.append(selectToolbar);

        const gizmo = new TranslateGizmo(scene.camera.camera, scene.gizmoLayer);
        const entity = new Entity('measureGizmoPivot');
        const transformHandler = new MeasureTransformHandler();

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

        const getMeasureScale = () => {
            const value = events.invoke('view.measureScale');
            return Number.isFinite(value) && value > 0 ? value : 1;
        };

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
            return units[lengthUnit.value as keyof typeof units] ? lengthUnit.value as keyof typeof units : 'm';
        };

        // get world space point
        const getPoint = (index: number, result: Vec3) => {
            splat.worldTransform.transformPoint(splat.measurePoints[index], result);
        };

        const getPoint2d = (index: number, result: Vec3) => {
            getPoint(index, result);
            scene.camera.worldToScreen(result, result);
            result.x *= canvasContainer.dom.clientWidth;
            result.y *= canvasContainer.dom.clientHeight;
        };

        const publishActivePoint = () => {
            if (splat && active && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                getPoint(splat.measureSelection, p);
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

            if (splat && active && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                getPoint(splat.measureSelection, p);
                t.set(p, Quat.IDENTITY, Vec3.ONE);
                events.invoke('pivot').place(t);
                entity.setLocalPosition(p);
                gizmo.attach(entity);
            }

            if (splat && splat.measurePoints.length >= 2) {
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
            } else {
                lengthInput.enabled = false;
                lengthInput.placeholder = '';
            }

            publishActivePoint();
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
            if (active) {
                // for now we always deactivate the tool so the current transform handler remains in place
                events.fire('tool.deactivate');
            }
        });

        events.on('pivot.started', () => {

        });

        events.on('pivot.moved', () => {
            if (active && splat && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                const p = events.invoke('pivot').transform.position;
                mat.invert(splat.worldTransform);
                mat.transformPoint(p, splat.measurePoints[splat.measureSelection]);
                publishActivePoint();
            }
            scene.forceRender = true;
        });

        events.on('pivot.ended', () => {
            if (active && splat && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                const draggedIndex = splat.measureSelection;
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
                            if (draggedIndex < targetSplat.measurePoints.length) {
                                mat.invert(targetSplat.worldTransform);
                                mat.transformPoint(snapped, p2);
                                targetSplat.measurePoints[draggedIndex].copy(p2);
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

        clearButton.on('click', () => {
            if (splat) {
                splat.measurePoints.length = 0;
                splat.measureSelection = -1;
                updateVisuals();
            }
        });

        events.on('select.delete', () => {
            if (active && splat && splat.measureSelection >= 0 && splat.measureSelection < splat.measurePoints.length) {
                splat.measurePoints.splice(splat.measureSelection, 1);
                splat.measureSelection--;
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

        const pointerup = async (e: PointerEvent) => {
            if (splat && clicked && isPrimary(e)) {
                clicked = false;

                let closestIdx = -1;

                // check for intersection with existing point
                for (let i = 0; i < splat.measurePoints.length; i++) {
                    getPoint2d(i, p);

                    if (Math.abs(p.x - e.offsetX) < 8 && Math.abs(p.y - e.offsetY) < 8) {
                        closestIdx = i;
                        break;
                    }
                }

                if (closestIdx >= 0) {
                    splat.measureSelection = closestIdx;
                    updateVisuals();
                    return;
                }

                if (splat.measurePoints.length < 3) {
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
            if (active && splat) {
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
                    } else {
                        if (i === 0) {
                            lineStart.setAttribute('visibility', 'hidden');
                        } else if (i === 1) {
                            lineMid.setAttribute('visibility', 'hidden');
                        } else {
                            lineEnd.setAttribute('visibility', 'hidden');
                        }
                    }
                }
            } else {
                line.setAttribute('visibility', 'hidden');
                line2.setAttribute('visibility', 'hidden');
                lineStart.setAttribute('visibility', 'hidden');
                lineMid.setAttribute('visibility', 'hidden');
                lineEnd.setAttribute('visibility', 'hidden');
            }
        });

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

            events.fire('transformHandler.push', transformHandler);
        };

        this.deactivate = () => {
            active = false;
            snapDraggedPoint = false;
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

            events.fire('transformHandler.pop');
        };
    }
}

export { MeasureTool };
