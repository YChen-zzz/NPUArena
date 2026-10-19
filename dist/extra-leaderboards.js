// Published results from the two NPU repository READMEs. Links are pinned to
// the commits read on 2026-10-19; the detail pages can refresh from GitHub.
window.NPU_ARENA_LEADERBOARDS = {
  airbench: {
    slug: 'airbench',
    displayOrder: 2,
    title: 'CIFAR-10 Airbench · NPU',
    repo: 'https://github.com/YChen-zzz/cifar10-airbench-npu',
    upstream: 'https://github.com/KellerJordan/cifar10-airbench',
    branch: 'master',
    sha: '45a390574593270f69a20517196cb380c9e4e606',
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
      { id: 'airbench-record02_optimization_v1', label: 'NPU 专项优化', description: 'per-rank local BatchNorm after the layer-wise batch split, per-rank local loss, side-stream proxy overlap, single-reduction final max-pool', seconds: 32.76, quality: '96.015%', type: 'optimized', folder: 'airbench_npu/record02_optimization_v1', log: 'airbench_npu/record02_optimization_v1/logs/20261016_180136_ddp.log' },
      { id: 'airbench-record03_optimization_v2', label: 'NPU 专项优化', description: 'two-rank local-BN DDP, compiled proxy and eval, streamed proxy masks', seconds: 34.14, quality: '96.083%', type: 'optimized', folder: 'airbench_npu/record03_optimization_v2', log: 'airbench_npu/record03_optimization_v2/logs/nogit_optimized_v1_acc20_20261019_172959.log' },
      { id: 'airbench-record01_kerminal_migration', label: '原算法移植', description: 'upstream port, training algorithm unchanged', seconds: 75.88, quality: '96.046%', type: 'baseline', folder: 'airbench_npu/record01_kerminal_migration', log: 'airbench_npu/record01_kerminal_migration/logs/20261016_134816_607999689.log' }
    ]
  },
  nanovlm: {
    slug: 'nanovlm',
    displayOrder: 1,
    title: 'nanoVLM · NPU',
    repo: 'https://github.com/YChen-zzz/nanoVLM-npu',
    upstream: 'https://github.com/huggingface/nanoVLM',
    branch: 'main',
    sha: '88bb0e7b243ac125ab1449b26d4e01096198d12d',
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
      { id: 'nanovlm-record02_optimization_v1', label: 'NPU 专项优化', description: 'NPU-targeted build on top of the port', seconds: 500.434, quality: '1.08362198', type: 'optimized', folder: 'nanoVLM_npu/record02_optimization_v1', log: 'nanoVLM_npu/record02_optimization_v1/logs/migrated_20261016.log' },
      { id: 'nanovlm-record01_kerminal_migration', label: '原算法移植', description: 'baseline port, upstream algorithm unchanged', seconds: 929.909, quality: '1.08315766', type: 'baseline', folder: 'nanoVLM_npu/record01_kerminal_migration', log: 'nanoVLM_npu/record01_kerminal_migration/logs/migrated_20261016.log' }
    ]
  }
};
