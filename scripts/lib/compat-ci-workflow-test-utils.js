export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractStepMetadata(workflowYaml, stepName) {
  const stepHeaderPattern = new RegExp(`\\n\\s+- name:\\s+${escapeRegex(stepName)}\\s*\\n`);
  const headerMatch = stepHeaderPattern.exec(workflowYaml);
  if (!headerMatch) {
    return null;
  }
  const startIndex = headerMatch.index;
  const nextStepIndex = workflowYaml.indexOf('\n      - name:', startIndex + headerMatch[0].length);
  return {
    startIndex,
    block: nextStepIndex < 0 ? workflowYaml.slice(startIndex) : workflowYaml.slice(startIndex, nextStepIndex)
  };
}

export function extractStepBlock(workflowYaml, stepName) {
  return extractStepMetadata(workflowYaml, stepName)?.block ?? null;
}

export function extractScalarField(stepBlock, fieldName) {
  const line = stepBlock
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${fieldName}:`));
  if (!line) {
    return null;
  }
  return line.replace(new RegExp(`^${escapeRegex(fieldName)}:\\s*`), '').trim();
}

export function extractRunCommand(stepBlock) {
  return extractScalarField(stepBlock, 'run');
}

export function extractEnvField(stepBlock, envKey) {
  return extractScalarField(stepBlock, envKey);
}

export function extractUsesField(stepBlock) {
  return extractScalarField(stepBlock, 'uses');
}

export function extractUploadArtifactPaths(stepBlock) {
  const lines = stepBlock.split('\n').map((line) => line.trim());
  const pathLineIndex = lines.findIndex((line) => line === 'path:' || line === 'path: |');
  if (pathLineIndex < 0) {
    return null;
  }
  const pathLines = [];
  for (let index = pathLineIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (line.startsWith('if-no-files-found:')) {
      break;
    }
    if (line.includes(':') && !line.startsWith('${{')) {
      break;
    }
    pathLines.push(line);
  }
  return pathLines;
}
