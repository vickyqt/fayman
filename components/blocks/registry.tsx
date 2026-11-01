"use client";
/**
 * The component registry: the only things the Teacher agent can "render".
 * Agent 3 emits { type, ...props }; this map picks the React component.
 */
import type { ComponentType } from "react";
import type { GuardedBlock } from "@/lib/schemas";
import type { BlockProps } from "./types";
import { ConceptBlock } from "./ConceptBlock";
import { InteractiveSliderBlock } from "./InteractiveSliderBlock";
import { FlowStepperDiagram } from "./FlowStepperDiagram";
import { DraggableArchitectureCanvas } from "./DraggableArchitectureCanvas";
import { ConceptCodeTracer } from "./ConceptCodeTracer";
import { PredictionBlock } from "./PredictionBlock";

export const REGISTRY: Record<GuardedBlock["type"], { label: string; Component: ComponentType<BlockProps<any>> }> = {
  concept: { label: "Concept", Component: ConceptBlock },
  slider: { label: "Simulation", Component: InteractiveSliderBlock },
  stepper: { label: "Step-through", Component: FlowStepperDiagram },
  architecture: { label: "Diagram", Component: DraggableArchitectureCanvas },
  code: { label: "Code trace", Component: ConceptCodeTracer },
  predict: { label: "Predict", Component: PredictionBlock },
};
