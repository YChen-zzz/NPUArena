// Published results from four NPU repository READMEs. Score snapshots use the
// latest README; record source/log links follow the versions listed there.
window.NPU_ARENA_LEADERBOARDS = {
  'vit-timm': {
    slug: 'vit-timm',
    displayOrder: 1,
    title: 'ViT-TIMM · NPU',
    repo: 'https://github.com/YChen-zzz/VIT-TIMM-npu',
    upstream: 'https://github.com/huggingface/pytorch-image-models',
    branch: 'main',
    sha: '2f351e078abeff73acea883320cddf29c17662a6',
    sectionHeading: 'NPU leaderboard record history',
    sectionAnchor: 'npu-leaderboard-record-history',
    recordMode: 'tagged',
    hardware: '4× Ascend 910C · 8 die',
    dataset: 'CIFAR-10',
    model: 'timm vit_base_patch16_224（ViT-B/16）',
    target: '最终 train loss 0.08390 ± 0.01',
    metric: '200 epoch 稳定训练时间',
    unit: 's',
    precision: 2,
    summary: '在 4 张 Ascend 910C 上从零训练 ViT-B/16，比较同一训练任务与质量门槛下的耗时。',
    timing: '200 个 epoch 的稳定训练时间；首个预热 epoch、验证和进程启动不计入。',
    rules: '保持模型、CIFAR-10 数据顺序、seed、batch、epoch 和学习率日程；最终 train loss 在 0.08390 ± 0.01 内，loss 曲线均值相对误差低于 5%。',
    qualityName: '最终 train loss',
    secondaryQualityName: 'Eval top1',
    records: [
      { id: 'vit-timm-record02_optimization', label: 'NPU 专项优化', description: 'patchify Linear, async gradient buckets, flat-gradient view, deferred loss metrics, bucket-local Adam', seconds: 1386.06, quality: '0.083367832', secondaryQuality: '84.22%', type: 'optimized', folder: 'source', log: 'logs/record02_optimization_20261017_201347.log', ref: 'record02_optimization' },
      { id: 'vit-timm-record01_kerminal_migration', label: '原算法移植', description: 'original NPU port', seconds: 1734.82, quality: '0.084322795', secondaryQuality: '84.01%', type: 'baseline', folder: 'source', log: 'logs/record01_kerminal_migration_20261017_201347.log', ref: 'record01_kerminal_migration' }
    ]
  },
  qwen3: {
    slug: 'qwen3',
    displayOrder: 2,
    title: 'Qwen3-0.6B · NPU',
    repo: 'https://github.com/YChen-zzz/Qwen3-transformers-npu',
    upstream: 'https://github.com/huggingface/transformers',
    branch: 'main',
    sha: '5ec51a278e3012a6e19ce6e455d366322d48af2f',
    sectionHeading: 'Record 概览',
    sectionAnchor: 'record-概览',
    recordMode: 'tagged',
    hardware: '8× Ascend 910C · 16 die',
    dataset: 'packed SlimPajama-6B',
    model: 'Qwen3-0.6B · Transformers Trainer',
    target: '最终 val loss 3.65582895 ± 0.01',
    metric: '2000 step 完整训练时间',
    unit: 's',
    precision: 2,
    summary: '在 8 张 Ascend 910C 上从随机权重预训练 Qwen3-0.6B，比较包含验证的完整训练时间。',
    timing: '2000 个 optimizer step 的完整运行时间，包含训练中的四次验证；不含作业排队和容器启动。',
    rules: '保持模型、数据顺序、seed、batch、梯度累积、step 数和学习率日程；最终 val loss 在 3.65582895 ± 0.01 内。',
    qualityName: '最终 val loss',
    records: [
      { id: 'qwen3-record02_optimization', label: 'NPU 专项优化', description: '本地 RMSNorm/SwiGLU、fused AdamW、FA2、fused LM-head/native NPU CE、deferred loss filter、DDP bucket 256 MiB / HCCL buffer 128 MiB', seconds: 1455.01, quality: '3.66289377', type: 'optimized', folder: 'source', log: 'logs/record02_optimization.log', ref: 'record02_optimization' },
      { id: 'qwen3-record01_kerminal_migration', label: '原算法移植', description: 'SDPA，标准 AdamW', seconds: 2437.64, quality: '3.65792727', type: 'baseline', folder: 'source', log: 'logs/record01_kerminal_migration.log', ref: 'record01_kerminal_migration' }
    ]
  },
  airbench: {
    slug: 'airbench',
    displayOrder: 3,
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
    displayOrder: 4,
    title: 'nanoVLM · NPU',
    repo: 'https://github.com/YChen-zzz/nanoVLM-npu',
    upstream: 'https://github.com/huggingface/nanoVLM',
    branch: 'main',
    sha: '3ed676f9c3bbd183069c2af5530405625a48be58',
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
