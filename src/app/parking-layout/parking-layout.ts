import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import Konva from 'konva';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-parking-layout',
  templateUrl: './parking-layout.html',
  styleUrls: ['./parking-layout.css'],
  imports: [FormsModule, CommonModule]
})
export class ParkingLayout implements AfterViewInit {
  @ViewChild('workDev', { static: true }) workDiv!: ElementRef;
  tooltip?: Konva.Label;
  layer?: Konva.Layer;
  stage?: Konva.Stage;
  transformer?: Konva.Transformer;

  // Shape management
  currentMode: 'view' | 'add' | 'edit' = 'view';
  currentShapeType: 'circle' | 'rect' | 'polygon' = 'circle';
  parkingShapes: any[] = [];
  selectedShape: any = null;
  metadataForm: any = {
    spotNumber: '',
    type: 'standard',
    occupied: false,
    width: 30,   // Default circle size
    height: 30,  // Default circle size
    shapeType: 'circle'
  };

  // Polygon state
  currentPolygon: Konva.Line | null = null;
  currentPoints: Konva.Circle[] = [];

  // Panning state
  isPanning = false;
  lastPointerPosition: { x: number; y: number } = { x: 0, y: 0 };
  backgroundImage: Konva.Image | null = null;
  spaceKeyPressed = false;

  ngAfterViewInit() {
    this.initializationKonva();
  }

  initializationKonva() {
    const container = this.workDiv.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const existingStage = Konva.stages.find(stage => stage.container() === container);
    if (existingStage) existingStage.destroy();

    this.stage = new Konva.Stage({ container, width, height });
    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    // Initialize transformer for full editing
    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 10,
      enabledAnchors: ['top-left', 'top-center', 'top-right', 'middle-right',
                       'bottom-right', 'bottom-center', 'bottom-left', 'middle-left'],
      boundBoxFunc: (oldBox, newBox) => {
        if (newBox.width < 5 || newBox.height < 5) {
          return oldBox;
        }
        return newBox;
      }
    });

    // Add transform event handler to properly handle polygon transformations
    this.transformer.on('transform', () => {
      const nodes = this.transformer?.nodes();
      if (nodes && nodes.length > 0 && nodes[0] instanceof Konva.Line) {
        this.handlePolygonTransform(nodes[0] as Konva.Line);
      }
    });
    this.layer.add(this.transformer);
    this.transformer.hide();

    // Tooltip initialization
    this.tooltip = new Konva.Label({ visible: false, listening: false });
    this.tooltip.add(new Konva.Tag({ fill: 'black', pointerDirection: 'down' }));
    this.tooltip.add(new Konva.Text({ text: '', fontFamily: 'Calibri', fontSize: 14, padding: 5, fill: 'white' }));
    this.layer.add(this.tooltip);

    // Zoom functionality
    const scaleBy = 1.05;
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const oldScale = this.stage?.scaleX() || 1;
      const pointer = this.stage?.getPointerPosition();

      if (pointer && this.stage) {
        const mousePointTo = {
          x: (pointer.x - this.stage.x()) / oldScale,
          y: (pointer.y - this.stage.y()) / oldScale
        };

        let direction = e.evt.deltaY > 0 ? 1 : -1;
        if (e.evt.ctrlKey) direction = -direction;

        const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;
        this.stage.scale({ x: newScale, y: newScale });

        const newPos = {
          x: pointer.x - mousePointTo.x * newScale,
          y: pointer.y - mousePointTo.y * newScale
        };
        this.stage.position(newPos);
        this.layer?.batchDraw();
      }
    });

    // Panning functionality
    this.stage.on('mousedown', (e) => {
      if (this.spaceKeyPressed || e.target === this.stage || e.target.name() === 'background') {
        this.isPanning = true;
        this.lastPointerPosition = this.stage?.getPointerPosition() || { x: 0, y: 0 };
        container.style.cursor = 'grabbing';
      }
    });

    this.stage.on('mousemove', (e) => {
      if (this.isPanning) {
        const pointerPos = this.stage?.getPointerPosition();
        if (!pointerPos) return;

        const dx = pointerPos.x - this.lastPointerPosition.x;
        const dy = pointerPos.y - this.lastPointerPosition.y;

        this.stage?.position({
          x: this.stage.x() + dx,
          y: this.stage.y() + dy
        });

        this.lastPointerPosition = pointerPos;
        this.layer?.batchDraw();
      } else if (e.target.name() === 'parking-shape') {
        this.showTooltip(e.target as any);
      }
    });

    this.stage.on('mouseup', () => {
      this.isPanning = false;
      container.style.cursor = this.spaceKeyPressed ? 'grab' : 'default';
    });

    // Keyboard shortcuts for panning and editing
    window.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        this.spaceKeyPressed = true;
        container.style.cursor = 'grab';
        this.parkingShapes.forEach(shape => shape.draggable(false));
      } else if (e.key === 'Escape') {
        // Exit edit mode when ESC is pressed
        if (this.currentMode === 'edit') {
          this.exitEditMode();
        } else if (this.currentMode === 'add' && this.currentShapeType === 'polygon') {
          // Cancel polygon creation if in polygon add mode
          this.cancelPolygon();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') {
        this.spaceKeyPressed = false;
        this.isPanning = false;
        container.style.cursor = 'default';

        // Only make shapes draggable if they're not polygons or if they're in edit mode
        this.parkingShapes.forEach(shape => {
          if (shape instanceof Konva.Line && shape.getAttr('metadata')?.shapeType === 'polygon') {
            shape.draggable(this.currentMode === 'edit' && this.selectedShape === shape);
          } else {
            shape.draggable(true);
          }
        });
      }
    });

    // Double-click to edit shape
    this.stage.on('dblclick', (e) => {
      // Always check for shapes at the clicked position, regardless of what was clicked
      const pos = this.stage?.getPointerPosition();
      if (pos) {
        const shapes = this.findShapesAtPosition(pos.x, pos.y);
        if (shapes.length > 0) {
          if (shapes.length > 1) {
            // If multiple shapes, show context menu to select which one to edit
            const menuItems = shapes.map((shape, index) => {
              const metadata = shape.getAttr('metadata') || {};
              const shapeType = metadata.shapeType || 'shape';
              const spotNumber = metadata.spotNumber || `#${index + 1}`;
              return {
                text: `Edit ${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} ${spotNumber}`,
                action: `select-${index}`
              };
            });

            this.showContextMenu(pos.x, pos.y, menuItems, (action) => {
              const match = action.match(/select-(\d+)/);
              if (match) {
                const index = parseInt(match[1]);
                if (index >= 0 && index < shapes.length) {
                  this.selectShape(shapes[index]);
                  this.currentMode = 'edit';
                }
              }
            });
          } else {
            // If only one shape, select it directly
            this.selectShape(shapes[0]);
            this.currentMode = 'edit';
          }
        }
      }
    });

    // Shape selection and context menu for polygon creation
    this.stage.on('contextmenu', (e) => {
      e.evt.preventDefault();
      if (this.isPanning) return;

      const pos = this.stage?.getPointerPosition();
      if (!pos) return;

      // Convert to stage coordinates considering zoom/pan
      const transform = this.stage?.getAbsoluteTransform().copy();
      if (!transform) return;
      transform.invert();
      const { x, y } = transform.point(pos);

      // Check if we're in polygon adding mode
      if (this.currentMode === 'add' && this.currentShapeType === 'polygon') {
        // Create a context menu for adding points to the polygon
        const menuItems = [
          { text: 'Add Point Here', action: 'add-point' },
          { text: 'Finish Polygon', action: 'finish-polygon' },
          { text: 'Cancel', action: 'cancel-polygon' }
        ];

        // Create and show context menu
        this.showContextMenu(pos.x, pos.y, menuItems, (action) => {
          if (action === 'add-point') {
            this.handlePolygonClick(e);
          } else if (action === 'finish-polygon') {
            this.finishPolygon();
          } else if (action === 'cancel-polygon') {
            this.cancelPolygon();
          }
        });
      } else {
        // Check if there are any shapes at this position
        const shapes = this.findShapesAtPosition(pos.x, pos.y);

        if (shapes.length > 0) {
          // If there are shapes at this position, show a context menu or select directly
          if (shapes.length > 1) {
            // If multiple shapes, show context menu to select which one to edit
            const menuItems = shapes.map((shape, index) => {
              const metadata = shape.getAttr('metadata') || {};
              const shapeType = metadata.shapeType || 'shape';
              const spotNumber = metadata.spotNumber || `#${index + 1}`;
              return {
                text: `Edit ${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)} ${spotNumber}`,
                action: `select-${index}`
              };
            });

            this.showContextMenu(pos.x, pos.y, menuItems, (action) => {
              const match = action.match(/select-(\d+)/);
              if (match) {
                const index = parseInt(match[1]);
                if (index >= 0 && index < shapes.length) {
                  this.selectShape(shapes[index]);
                  this.currentMode = 'edit';
                }
              }
            });
          } else {
            // If only one shape, select it directly
            this.selectShape(shapes[0]);
            this.currentMode = 'edit';
          }
        } else {
          // If no shapes at this position, show context menu for polygon creation
          const menuItems = [
            { text: 'Create Polygon Here', action: 'create-polygon' },
            { text: 'Cancel', action: 'cancel' }
          ];

          // Create and show context menu
          this.showContextMenu(pos.x, pos.y, menuItems, (action) => {
            if (action === 'create-polygon') {
              this.deselectAll();
              this.currentShapeType = 'polygon';
              this.metadataForm.shapeType = 'polygon';
              this.currentMode = 'add';
              this.startPolygonMode();
              this.handlePolygonClick(e);
            }
          });
        }
      }
    });

    this.layer.draw();
  }

  setShapeType(type: 'circle' | 'rect' | 'polygon') {
    this.currentShapeType = type;
    this.metadataForm.shapeType = type;

    // Set appropriate default sizes
    if (type === 'circle') {
      this.metadataForm.width = 30;
      this.metadataForm.height = 30;
    } else if (type === 'rect') {
      this.metadataForm.width = 60;
      this.metadataForm.height = 30;
    } else {
      this.metadataForm.width = 0;
      this.metadataForm.height = 0;
    }
  }

  startAddMode() {
    this.deselectAll();
    this.currentMode = 'add';

    if (this.currentShapeType === 'polygon') {
      this.startPolygonMode();
    } else {
      const container = this.workDiv.nativeElement;
      const stagePos = this.stage?.position() || { x: 0, y: 0 };
      const stageScale = this.stage?.scaleX() || 1;

      const x = (container.clientWidth/2 - stagePos.x) / stageScale;
      const y = (container.clientHeight/2 - stagePos.y) / stageScale;

      this.createParkingShape(x, y);
    }
  }

  createParkingShape(x: number, y: number) {
    let shape: Konva.Shape;
    const fillColor = this.metadataForm.occupied ? 'red' : 'green';

    switch (this.currentShapeType) {
      case 'circle':
        shape = new Konva.Circle({
          x,
          y,
          radius: this.metadataForm.width / 2,
          fill: fillColor,
          stroke: 'black',
          strokeWidth: 1,
          name: 'parking-shape',
          draggable: true,
        });
        break;

      case 'rect':
        shape = new Konva.Rect({
          x,
          y,
          width: this.metadataForm.width,
          height: this.metadataForm.height,
          fill: 'rgba(0, 100, 255, 0.3)',
          stroke: 'blue',
          strokeWidth: 2,
          name: 'parking-shape',
          draggable: true,
          cornerRadius: 4,
        });
        break;

      default:
        return;
    }

    // Add metadata
    shape.setAttr('metadata', {
      ...this.metadataForm,
      shapeType: this.currentShapeType
    });

    // Add hover effects
    shape.on('mouseenter', () => {
      if (!this.spaceKeyPressed) {
        document.body.style.cursor = 'move';
        this.showTooltip(shape);
      }
    });

    shape.on('mouseleave', () => {
      document.body.style.cursor = 'default';
      if (this.tooltip) this.tooltip.visible(false);
      this.layer?.draw();
    });

    shape.on('dragmove', () => {
      this.showTooltip(shape);
    });

    // We use the stage-level double-click handler instead
    // to ensure consistent behavior with overlapping shapes

    this.layer?.add(shape);
    // Move the shape to the top to ensure it's above other shapes
    shape.moveToTop();
    this.parkingShapes.push(shape);
    this.selectShape(shape);
    this.layer?.batchDraw();
  }

  startPolygonMode() {
    console.log('startPolygonMode');

    // Clear any existing polygon
    if (this.currentPolygon) {
      this.currentPolygon.destroy();
      this.currentPolygon = null;
    }

    // Remove all control points from the layer and destroy them
    this.layer?.find('.polygon-point').forEach(node => node.destroy());
    this.currentPoints = [];

    // Force a redraw to ensure all elements are properly removed
    this.layer?.batchDraw();
  }

  handlePolygonClick(e: Konva.KonvaEventObject<MouseEvent>) {
    const pos = this.stage?.getPointerPosition();
    if (!pos) return;

    // Convert to stage coordinates considering zoom/pan
    const transform = this.stage?.getAbsoluteTransform().copy();
    if (!transform) return;
    transform.invert();
    const { x, y } = transform.point(pos);

    if (!this.currentPolygon) {
      // Create new polygon
      this.currentPolygon = new Konva.Line({
        points: [x, y, x, y], // Initialize with two points to draw a line
        stroke: 'blue',
        strokeWidth: 2,
        lineCap: 'round',
        lineJoin: 'round',
        closed: false, // Start as open polygon
        fill: 'rgba(100, 100, 255, 0.3)',
        draggable: true,
        name: 'parking-shape',
      });

      this.layer?.add(this.currentPolygon);

      // Add first point
      this.addPolygonPoint(x, y);
    } else {
      // Add new point to existing polygon
      this.addPolygonPoint(x, y);

      // Update polygon points by adding the new point to the existing points
      const points = [...this.currentPolygon.points()]; // Create a copy of the points array

      // Remove the duplicate point at the end (if any)
      if (points.length >= 4) {
        points.pop(); // Remove y coordinate of last point
        points.pop(); // Remove x coordinate of last point
      }

      // Add the new point
      points.push(x, y);

      // Set the updated points array
      this.currentPolygon.points(points);

      // Update the visual representation
      this.currentPolygon.closed(this.currentPoints.length >= 3);
      this.layer?.batchDraw();
    }
  }

  addPolygonPoint(x: number, y: number) {
    const point = new Konva.Circle({
      x,
      y,
      radius: 5,
      fill: 'yellow',
      stroke: 'black',
      strokeWidth: 1,
      draggable: true,
      name: 'polygon-point'
    });

    point.on('dragmove', () => {
      // Get the current points array
      const points = [...this.currentPolygon!.points()];

      // Find the index of this point in the array
      const index = this.currentPoints.indexOf(point) * 2;

      // Update the point's coordinates
      points[index] = point.x();
      points[index + 1] = point.y();

      // Set the updated points array
      this.currentPolygon!.points(points);

      // Update the visual representation when dragging points
      if (this.currentPoints.length >= 3) {
        this.currentPolygon!.closed(true);
      }

      // Force redraw to update the visual representation
      this.layer?.batchDraw();
    });

    this.currentPoints.push(point);
    this.layer?.add(point);
    this.layer?.batchDraw();
  }

  finishPolygon() {
    if (!this.currentPolygon || this.currentPoints.length < 3) return;

    // Close the polygon
    this.currentPolygon.closed(true);

    // Set polygon metadata
    this.currentPolygon.setAttr('metadata', {
      ...this.metadataForm,
      shapeType: 'polygon'
    });

    // Add hover events
    this.currentPolygon.on('mouseenter', () => {
      document.body.style.cursor = 'pointer';
      if (this.tooltip) {
        const text = this.tooltip.getChildren()[1] as Konva.Text;
        text.text(`Polygon: ${this.currentPolygon?.getAttr('metadata').spotNumber || 'Polygon'}`);
        const pos = this.stage?.getPointerPosition();
        if (pos) {
          this.tooltip.position(pos);
          this.tooltip.visible(true);
          this.layer?.draw();
        }
      }
    });

    this.currentPolygon.on('mouseleave', () => {
      document.body.style.cursor = 'default';
      if (this.tooltip) {
        this.tooltip.visible(false);
        this.layer?.draw();
      }
    });

    // Save to shapes collection
    this.parkingShapes.push(this.currentPolygon);

    // Move the polygon to the top to ensure it's above other shapes
    this.currentPolygon.moveToTop();

    // Make the polygon non-draggable by default (only draggable in edit mode)
    this.currentPolygon.draggable(false);

    // Remove all control points from the layer and destroy them
    this.layer?.find('.polygon-point').forEach(node => node.destroy());
    this.currentPoints = [];

    // Store the completed polygon before nullifying it
    const completedPolygon = this.currentPolygon;
    this.currentPolygon = null;
    this.currentMode = 'view';

    // Force a redraw to ensure all points are removed visually
    this.layer?.batchDraw();

    // Select the shape after cleanup
    this.selectShape(completedPolygon);
  }

  cancelPolygon() {
    if (this.currentPolygon) this.currentPolygon.destroy();

    // Remove all control points from the layer and destroy them
    this.layer?.find('.polygon-point').forEach(node => node.destroy());
    this.currentPoints = [];

    this.currentPolygon = null;
    this.currentMode = 'view';
    this.layer?.batchDraw();
  }

  showTooltip(shape: Konva.Shape) {
    if (!this.tooltip || !this.stage) return;

    const text = this.tooltip.getChildren()[1] as Konva.Text;
    const metadata = shape.getAttr('metadata');
    const shapeType = metadata?.shapeType || 'shape';

    let tooltipText = `${shapeType.charAt(0).toUpperCase() + shapeType.slice(1)}`;
    if (metadata.spotNumber) {
      tooltipText += `: ${metadata.spotNumber}`;
    }
    if (metadata.type) {
      tooltipText += `\nType: ${metadata.type}`;
    }

    text.text(tooltipText);

    const pos = this.stage.getPointerPosition();
    if (pos) {
      this.tooltip.position({
        x: pos.x + 10,
        y: pos.y + 10
      });
      this.tooltip.visible(true);
      this.layer?.draw();
    }
  }

  selectShape(shape: Konva.Shape) {
    this.deselectAll();

    // Reset transformer settings to defaults
    if (this.transformer) {
      this.transformer.resizeEnabled(true);
      this.transformer.rotateEnabled(true);
      this.transformer.borderDash([]);
      this.transformer.anchorSize(8);
      this.transformer.anchorCornerRadius(3);
      this.transformer.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right',
                                      'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
    }

    // Special handling for polygons (Konva.Line)
    if (shape instanceof Konva.Line && shape.getAttr('metadata')?.shapeType === 'polygon') {
      // Make sure any remaining control points are removed
      this.layer?.find('.polygon-point').forEach(node => node.destroy());

      // For polygons, only enable dragging in edit mode
      shape.draggable(this.currentMode === 'edit');
    }
    // Special handling for circles
    else if (shape instanceof Konva.Circle) {
      // For circles, we want all anchors to maintain the circle shape
      if (this.transformer) {
        this.transformer.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right',
                                        'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
      }
    }
    // Special handling for rectangles
    else if (shape instanceof Konva.Rect) {
      // For rectangles, we want all anchors
      if (this.transformer) {
        this.transformer.enabledAnchors(['top-left', 'top-center', 'top-right', 'middle-right',
                                        'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']);
      }
    }

    // Bring the selected shape to the top to ensure transformer works correctly
    shape.moveToTop();

    // Apply transformer to the shape only in edit mode
    if (this.transformer) {
      if (this.currentMode === 'edit') {
        this.transformer.nodes([shape]);
        this.transformer.moveToTop(); // Ensure transformer is on top of the shape
        this.transformer.show();
      } else {
        this.transformer.hide();
        this.transformer.nodes([]);
      }
    }

    this.selectedShape = shape;

    // Highlight selected shape
    if (shape instanceof Konva.Line) {
      shape.stroke('red');
      shape.strokeWidth(3);
    } else {
      shape.stroke('red');
      shape.strokeWidth(3);
    }

    // Populate metadata form
    const metadata = shape.getAttr('metadata') || {};
    this.metadataForm = {
      ...metadata,
      width: shape instanceof Konva.Circle ? shape.radius() * 2 : shape.width(),
      height: shape instanceof Konva.Circle ? shape.radius() * 2 : shape.height(),
      shapeType: metadata.shapeType || 'circle'
    };

    this.layer?.batchDraw();
  }

  deselectAll() {
    this.parkingShapes.forEach(shape => {
      if (shape instanceof Konva.Line) {
        shape.stroke('blue');
        shape.strokeWidth(2);

        // Make sure polygons are not draggable when deselected
        if (shape.getAttr('metadata')?.shapeType === 'polygon') {
          shape.draggable(false);
        }
      } else {
        shape.stroke('black');
        shape.strokeWidth(1);
      }
    });

    if (this.transformer) {
      this.transformer.hide();
      this.transformer.nodes([]);
    }

    this.selectedShape = null;
    this.layer?.batchDraw();
  }

  exitEditMode() {
    if (this.currentMode === 'edit') {
      this.currentMode = 'view';

      // Make sure the selected polygon is not draggable
      if (this.selectedShape instanceof Konva.Line &&
          this.selectedShape.getAttr('metadata')?.shapeType === 'polygon') {
        this.selectedShape.draggable(false);
      }

      // Hide transformer
      if (this.transformer) {
        this.transformer.hide();
        this.transformer.nodes([]);
      }

      this.layer?.batchDraw();
    }
  }

  saveMetadata() {
    if (this.selectedShape) {
      // Update shape properties based on type
      if (this.selectedShape instanceof Konva.Circle) {
        this.selectedShape.radius(this.metadataForm.width / 2);
      } else if (this.selectedShape instanceof Konva.Rect) {
        this.selectedShape.width(this.metadataForm.width);
        this.selectedShape.height(this.metadataForm.height);
      }

      // Update color for circles
      if (this.selectedShape instanceof Konva.Circle) {
        this.selectedShape.fill(this.metadataForm.occupied ? 'red' : 'green');
      }

      // Update metadata
      this.selectedShape.setAttr('metadata', {
        spotNumber: this.metadataForm.spotNumber,
        type: this.metadataForm.type,
        occupied: this.metadataForm.occupied,
        shapeType: this.metadataForm.shapeType
      });

      // Update transformer
      this.transformer?.forceUpdate();
      this.layer?.batchDraw();
    }
  }

  updateDimensions() {
    if (this.selectedShape) {
      if (this.selectedShape instanceof Konva.Circle) {
        this.selectedShape.radius(this.metadataForm.width / 2);
      } else if (this.selectedShape instanceof Konva.Rect) {
        this.selectedShape.width(this.metadataForm.width);
        this.selectedShape.height(this.metadataForm.height);
      }
      this.transformer?.forceUpdate();
      this.layer?.batchDraw();
    }
  }

  deleteSelected() {
    if (this.selectedShape) {
      const index = this.parkingShapes.indexOf(this.selectedShape);
      if (index > -1) {
        this.parkingShapes.splice(index, 1);
      }

      this.selectedShape.destroy();
      this.deselectAll();
      this.layer?.batchDraw();
    }
  }

  addIMG(imgSrc: any) {
    const container = this.workDiv.nativeElement;

    if (this.backgroundImage) {
      this.backgroundImage.destroy();
      this.backgroundImage = null;
      this.layer?.batchDraw();
    }

    const imageObj = new Image();

    imageObj.onload = () => {
      const containerRatio = container.clientWidth / container.clientHeight;
      const imageRatio = imageObj.width / imageObj.height;

      let width, height;
      if (containerRatio > imageRatio) {
        height = container.clientHeight;
        width = imageObj.width * (height / imageObj.height);
      } else {
        width = container.clientWidth;
        height = imageObj.height * (width / imageObj.width);
      }

      this.backgroundImage = new Konva.Image({
        x: (container.clientWidth - width) / 2,
        y: (container.clientHeight - height) / 2,
        width,
        height,
        image: imageObj,
        name: 'background',
        draggable: false,
        listening: false,
      });

      // Add image below all other elements
      this.layer?.add(this.backgroundImage);
      this.backgroundImage.moveToBottom();
      this.layer?.draw();
    };

    imageObj.src = imgSrc;
  }

  getFile(ev: any) {
    this.addIMG(URL.createObjectURL(ev.target.files[0]));
  }

  handlePolygonTransform(polygon: Konva.Line) {
    // This method ensures that polygons are transformed correctly
    // It's called during the transformer's transform event

    // Make sure the polygon stays closed during transformation
    if (polygon.closed()) {
      // Force a redraw to ensure the polygon is rendered correctly
      this.layer?.batchDraw();
    }
  }

  findShapesAtPosition(x: number, y: number): Konva.Shape[] {
    if (!this.layer) return [];

    // Convert screen coordinates to stage coordinates
    const transform = this.stage?.getAbsoluteTransform().copy();
    if (!transform) return [];
    transform.invert();
    const stagePoint = transform.point({ x, y });

    // Find all shapes that contain this point
    const shapes: Konva.Shape[] = [];
    this.parkingShapes.forEach(shape => {
      // For circles
      if (shape instanceof Konva.Circle) {
        const dx = shape.x() - stagePoint.x;
        const dy = shape.y() - stagePoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= shape.radius()) {
          shapes.push(shape);
        }
      }
      // For rectangles
      else if (shape instanceof Konva.Rect) {
        const halfWidth = shape.width() / 2;
        const halfHeight = shape.height() / 2;
        const rotation = shape.rotation() * Math.PI / 180;

        // Adjust for rotation
        const rotatedX = Math.cos(rotation) * (stagePoint.x - shape.x()) -
                         Math.sin(rotation) * (stagePoint.y - shape.y()) + shape.x();
        const rotatedY = Math.sin(rotation) * (stagePoint.x - shape.x()) +
                         Math.cos(rotation) * (stagePoint.y - shape.y()) + shape.y();

        if (rotatedX >= shape.x() - halfWidth &&
            rotatedX <= shape.x() + halfWidth &&
            rotatedY >= shape.y() - halfHeight &&
            rotatedY <= shape.y() + halfHeight) {
          shapes.push(shape);
        }
      }
      // For polygons
      else if (shape instanceof Konva.Line && shape.getAttr('metadata')?.shapeType === 'polygon') {
        if (shape.closed() && this.isPointInPolygon(stagePoint, shape.points())) {
          shapes.push(shape);
        }
      }
    });

    // Sort shapes by z-index (shapes with higher z-index should be first)
    // This ensures that shapes on top are selected first
    shapes.sort((a, b) => {
      // Get the z-index of each shape (higher index means it's on top)
      const aIndex = this.layer!.children.indexOf(a);
      const bIndex = this.layer!.children.indexOf(b);
      return bIndex - aIndex; // Reverse order so higher indices come first
    });

    return shapes;
  }

  isPointInPolygon(point: { x: number, y: number }, polygonPoints: number[]): boolean {
    // Ray casting algorithm to determine if a point is inside a polygon
    let inside = false;
    for (let i = 0, j = polygonPoints.length - 2; i < polygonPoints.length; j = i, i += 2) {
      const xi = polygonPoints[i];
      const yi = polygonPoints[i + 1];
      const xj = polygonPoints[j];
      const yj = polygonPoints[j + 1];

      const intersect = ((yi > point.y) !== (yj > point.y)) &&
                        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  showContextMenu(x: number, y: number, items: { text: string, action: string }[], callback: (action: string) => void) {
    // Remove any existing context menu
    const existingMenu = this.layer?.find('.context-menu');
    existingMenu?.forEach(node => node.destroy());

    // Create container group
    const menuGroup = new Konva.Group({
      x,
      y,
      name: 'context-menu'
    });

    // Calculate menu dimensions
    const padding = 8;
    const itemHeight = 30;
    const menuWidth = 180;
    const menuHeight = items.length * itemHeight + padding * 2;

    // Create menu background
    const menuBackground = new Konva.Rect({
      width: menuWidth,
      height: menuHeight,
      fill: 'white',
      stroke: '#ddd',
      strokeWidth: 1,
      cornerRadius: 4,
      shadowColor: 'black',
      shadowBlur: 10,
      shadowOffset: { x: 2, y: 2 },
      shadowOpacity: 0.2
    });

    menuGroup.add(menuBackground);

    // Add menu items
    items.forEach((item, index) => {
      const itemY = padding + index * itemHeight;

      // Item background (for hover effect)
      const itemBackground = new Konva.Rect({
        y: itemY,
        width: menuWidth,
        height: itemHeight,
        fill: 'transparent',
        name: `menu-item-${item.action}`
      });

      // Item text
      const itemText = new Konva.Text({
        y: itemY + itemHeight / 2,
        x: padding,
        text: item.text,
        fontSize: 14,
        fontFamily: 'Arial',
        fill: 'black',
        verticalAlign: 'middle'
      });

      // Add hover effect
      itemBackground.on('mouseenter', () => {
        itemBackground.fill('#f0f0f0');
        this.layer?.batchDraw();
      });

      itemBackground.on('mouseleave', () => {
        itemBackground.fill('transparent');
        this.layer?.batchDraw();
      });

      // Add click handler
      itemBackground.on('click', () => {
        // Remove menu
        menuGroup.destroy();
        this.layer?.batchDraw();

        // Execute callback with action
        callback(item.action);
      });

      menuGroup.add(itemBackground);
      menuGroup.add(itemText);
    });

    // Add menu to layer
    this.layer?.add(menuGroup);
    this.layer?.batchDraw();

    // Close menu when clicking outside
    const closeHandler = (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!e.target.hasName('menu-item') && !e.target.hasName('context-menu')) {
        menuGroup.destroy();
        this.layer?.batchDraw();
        this.stage?.off('click', closeHandler);
      }
    };

    this.stage?.on('click', closeHandler);
  }
}
