// Published results from the two NPU repository READMEs. Links are pinned to
// the commits read on 2026-10-16; the detail pages can refresh from GitHub.
window.NPU_ARENA_LEADERBOARDS = {
  airbench: {
    slug: 'airbench',
    displayOrder: 2,
    title: 'CIFAR-10 Airbench · NPU',
    repo: 'https://github.com/YChen-zzz/cifar10-airbench-npu',
    upstream: 'https://github.com/KellerJordan/cifar10-airbench',
    branch: 'master',
    sha: '2285f94af2348c6de273a1c3a8b12dec88199a47',
    hardware: '1× Ascend 910C · 2 die',
    dataset: 'CIFAR-10',
    model: 'Airbench 96% 训练任务',
    target: '平均 TTA 准确率 ≥ 96.0%',
    metric: '20 次完整训练的平均耗时',
    unit: 's',
    precision: 2,
    summary: '在单张 Ascend 910C 上复现 CIFAR-10 Airbench 96% 训练，比较达到准确率门槛的平均耗时。',
    timing: '至少 20 次完整训练；每次从模型创建计时到最终测试时增强，并进行设备同步。',
    rules: '保持 CIFAR-10 划分、数据增强、难例筛选与 45 epoch 训练日程；允许调整 batch 划分、并行、融合与数值格式。',
    qualityName: '平均 TTA 准确率',
    records: [
      { id: 'airbench-optimized', label: 'NPU 专项优化', description: '整体 BatchNorm、每 rank 本地 loss、侧流重叠与最终池化优化', seconds: 32.66, quality: '96.015%', type: 'optimized', folder: 'airbench_npu/optimized', log: 'airbench_npu/optimized/logs/20261016_180136_ddp.log' },
      { id: 'airbench-baseline', label: '原算法移植', description: '上游训练算法不变的 Ascend NPU 移植', seconds: 75.88, quality: '96.046%', type: 'baseline', folder: 'airbench_npu/baseline', log: 'airbench_npu/baseline/logs/20261016_134816_607999689.log' }
    ]
  },
  nanovlm: {
    slug: 'nanovlm',
    displayOrder: 1,
    title: 'nanoVLM · NPU',
    repo: 'https://github.com/YChen-zzz/nanoVLM-npu',
    upstream: 'https://github.com/huggingface/nanoVLM',
    branch: 'main',
    sha: '65c0eeab924a32777a86bc78e541f75836201bfd',
    hardware: '8× Ascend NPU · 16 die',
    dataset: 'FineVision',
    model: 'SigLIP2 + SmolLM2 视觉语言模型',
    target: '最终验证损失 1.08 ± 0.01',
    metric: '200 个计时 step 的训练耗时',
    unit: 's',
    precision: 3,
    summary: '在 8 张 Ascend NPU 上训练 nanoVLM，比较同一任务和质量范围内的计时训练区间。',
    timing: '完整运行 210 step，前 10 step 为预热；只计后 200 step，模型加载和最终验证不计时。',
    rules: '保持模型、数据顺序、随机种子、全局 batch、梯度累积、step 数与学习率日程；允许算子及精度优化。',
    qualityName: '最终验证损失',
    records: [
      { id: 'nanovlm-optimized', label: 'NPU 专项优化', description: '针对 Ascend NPU 的算子与精度优化版本', seconds: 500.434, quality: '1.08362198', type: 'optimized', folder: 'nanoVLM_npu/optimized', log: 'nanoVLM_npu/optimized/logs/migrated_20261016.log' },
      { id: 'nanovlm-baseline', label: '原算法移植', description: '保持上游训练算法的 NPU 基线移植', seconds: 929.909, quality: '1.08315766', type: 'baseline', folder: 'nanoVLM_npu/baseline', log: 'nanoVLM_npu/baseline/logs/migrated_20261016.log' }
    ]
  }
};
