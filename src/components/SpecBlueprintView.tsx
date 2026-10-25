import React, { useState } from 'react';
import {
  CheckSquare,
  Download,
  FileCode2,
  FileText,
  Layers,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { INITIAL_SPEC_FORM, MVP_FEATURE_CHECKLIST } from '../data/presets';
import { SpecDecisionForm } from '../types/editor';
import { saveAndShareFileOnDevice } from '../utils/androidBridge';

interface SpecBlueprintViewProps {
  specForm: SpecDecisionForm;
  onChangeSpecForm: (updated: SpecDecisionForm) => void;
  onOpenEditor: () => void;
}

export const SpecBlueprintView: React.FC<SpecBlueprintViewProps> = ({
  specForm,
  onChangeSpecForm,
  onOpenEditor,
}) => {
  const [activeTab, setActiveTab] = useState<'form' | 'features' | 'architecture' | 'roadmap'>('form');
  const [copiedNotice, setCopiedNotice] = useState(false);

  const toggleMvpFeature = (id: string) => {
    const exists = specForm.selectedMvpFeatures.includes(id);
    const next = exists
      ? specForm.selectedMvpFeatures.filter((item) => item !== id)
      : [...specForm.selectedMvpFeatures, id];
    onChangeSpecForm({ ...specForm, selectedMvpFeatures: next });
  };

  const generateMarkdownPrd = () => {
    const selectedLabels = MVP_FEATURE_CHECKLIST.filter((f) =>
      specForm.selectedMvpFeatures.includes(f.id)
    )
      .map((f) => `- [x] (${f.phase}) ${f.section}: ${f.labelHi}`)
      .join('\n');

    return `# ${specForm.finalAppName} — मास्टर प्रोडक्ट स्पेसिफिकेशन (PRD)

## 1. प्रोजेक्ट ओवरव्यू (Project Overview)
- **ऐप का फाइनल नाम:** ${specForm.finalAppName}
- **टैगलाइन:** ${specForm.tagline}
- **प्लेटफॉर्म रणनीति:** ${specForm.primaryPlatform}
- **चुना हुआ टेक स्टैक:** ${specForm.techStack}
- **टारगेट ऑडियंस और खास Niche:** ${specForm.targetAudienceNiche}
- **बिज़नेस मॉडल और मॉनेटाइज़ेशन:** ${specForm.monetizationModel} (रीवार्डेड ऐड: ${specForm.rewardedAdsEnabled ? 'हाँ' : 'नहीं'})
- **AI निष्पादन रणनीति:** ${specForm.aiExecutionStrategy}
- **टीम साइज़ और स्किल्स:** ${specForm.teamSizeAndSkills}
- **बजट (Dev + Cloud + Licensing):** ${specForm.budgetBreakdown}
- **लॉन्च टारगेट तारीख:** ${specForm.launchTargetDate}
- **मुख्य USP:** ${specForm.coreUsp}

## 2. गोल्स और परफॉर्मेंस मेट्रिक्स
- नया यूज़र 60 सेकंड के अंदर अपना पहला वीडियो बनाकर एक्सपोर्ट कर सके।
- **एक्सपोर्ट स्पीड टारगेट:** ${specForm.exportTargetSpeed}
- **मिनिमम डिवाइस सपोर्ट:** ${specForm.minDeviceSpec}
- **क्रैश-फ्री सेशन रेट:** > 99.0%

## 3. चुने गए MVP और V2 फीचर्स (${specForm.selectedMvpFeatures.length}/${MVP_FEATURE_CHECKLIST.length})
${selectedLabels}

## 4. लीगल और ट्रेडमार्क स्थिति
- **ट्रेडमार्क और लाइसेंस स्थिति:** ${specForm.trademarkStatus}
- म्यूज़िक: सिर्फ़ रॉयल्टी-फ्री / लाइसेंस्ड ट्रैक; फॉन्ट्स: Google Fonts OFL (Noto Sans Devanagari, Rozha One, Kalam, Outfit).
`;
  };

  const handleDownloadMarkdown = async () => {
    const md = generateMarkdownPrd();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const fileName = `${specForm.finalAppName.replace(/\s+/g, '_')}_Master_Spec_PRD.md`;
    await saveAndShareFileOnDevice(blob, fileName, 'ClipNova Master Spec PRD');
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(generateMarkdownPrd());
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 pb-6 border-b border-slate-800">
        <div className="space-y-2 max-w-3xl">
          <div className="text-xs font-medium text-amber-400">
            मास्टर प्रोडक्ट स्पेसिफिकेशन · Interactive PRD & Decision Studio
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 tracking-tight">
            {specForm.finalAppName} — प्रोडक्ट ब्लूप्रिंट और निर्णय फॉर्म
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            आपके स्पेसिफिकेशन के सभी <span className="text-slate-200 font-medium">[भरें: ...]</span> फ़ील्ड्स यहाँ इंटरैक्टिव रूप से भरे जा सकते हैं। बदलाव अपने आप सेव होते हैं और आप इन्हें Markdown PRD के रूप में डाउनलोड कर सकते हैं या सीधे फेज़ 0 वीडियो एडिटर इंजन चला सकते हैं।
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="min-h-[42px] px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <FileText className="w-4 h-4 text-amber-400" />
            <span>{copiedNotice ? 'PRD कॉपी हो गया!' : 'Copy PRD Markdown'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="min-h-[42px] px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4 text-sky-400" />
            <span>Download .MD Spec</span>
          </button>
          <button
            type="button"
            onClick={onOpenEditor}
            className="min-h-[42px] px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>फेज़ 0 वीडियो एडिटर चलाएं</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('form')}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'form'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            01. निर्णय फॉर्म ([भरें: ...])
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('features')}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'features'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            02. फीचर मास्टर लिस्ट (MVP / V2 / V3)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('architecture')}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'architecture'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            03. टेक्निकल आर्किटेक्चर और डेटा मॉडल
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('roadmap')}
            className={`px-4 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'roadmap'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            04. रोडमैप, लीगल और रिस्क
          </button>
        </div>

        <button
          type="button"
          onClick={() => onChangeSpecForm(INITIAL_SPEC_FORM)}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>डिफ़ॉल्ट सुझाव रीसेट करें</span>
        </button>
      </div>

      {/* TAB 1: Interactive Decision Form (Section 1, 2, 6, 7, 10) */}
      {activeTab === 'form' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-8 space-y-6 bg-[#0F1522] border border-slate-800 rounded-xl p-6">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-lg font-semibold text-slate-100">
                10. आपके भरने के लिए मास्टर फॉर्म (Project & Business Decisions)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                स्पेसिफिकेशन में जहाँ भी [भरें: ...] था, वहाँ भारतीय शॉर्ट-फॉर्म क्रिएटर मार्केट के अनुसार अनुशंसित विकल्प भरे गए हैं जिन्हें आप अपनी टीम के अनुसार बदल सकते हैं।
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  ऐप का फाइनल नाम [भरें: फाइनल नाम]
                </label>
                <input
                  type="text"
                  value={specForm.finalAppName}
                  onChange={(e) => onChangeSpecForm({ ...specForm, finalAppName: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  लॉन्च टारगेट [भरें: तारीख]
                </label>
                <input
                  type="date"
                  value={specForm.launchTargetDate}
                  onChange={(e) => onChangeSpecForm({ ...specForm, launchTargetDate: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 font-mono tabular-nums focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  टैगलाइन [भरें]
                </label>
                <input
                  type="text"
                  value={specForm.tagline}
                  onChange={(e) => onChangeSpecForm({ ...specForm, tagline: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  पहले कौन सा प्लेटफॉर्म [भरें: कन्फर्म]
                </label>
                <select
                  value={specForm.primaryPlatform}
                  onChange={(e) =>
                    onChangeSpecForm({
                      ...specForm,
                      primaryPlatform: e.target.value as SpecDecisionForm['primaryPlatform'],
                    })
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Android First (Kotlin + Media3 + OpenGL ES)">
                    Android पहले, फिर iOS (Recommended for India)
                  </option>
                  <option value="Both Android & iOS (Flutter + C++ Engine)">
                    Android और iOS दोनों एक साथ (Flutter + C++ Core)
                  </option>
                  <option value="Web + Mobile PWA + Native Shell">
                    Web Studio + Mobile PWA + Native Wrapper
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  चुना हुआ टेक स्टैक [भरें: चुना हुआ स्टैक]
                </label>
                <select
                  value={specForm.techStack}
                  onChange={(e) =>
                    onChangeSpecForm({
                      ...specForm,
                      techStack: e.target.value as SpecDecisionForm['techStack'],
                    })
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Native Android (Kotlin) + Media3/Transformer + OpenGL ES">
                    Native Android (Kotlin) + Media3 + OpenGL ES
                  </option>
                  <option value="C++ Cross-Platform Core (FFmpeg + OpenGL) + UI Shell">
                    C++ Cross-Platform Core (FFmpeg + OpenGL) + UI Shell
                  </option>
                  <option value="Flutter + Native Video Engine Plugins">
                    Flutter UI + Native Video Engine Plugins
                  </option>
                  <option value="React Native + Native GPU Modules">
                    React Native + Native GPU Modules
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  मॉनेटाइज़ेशन और रीवार्डेड ऐड [भरें: ऐड रखनी है या नहीं]
                </label>
                <select
                  value={specForm.monetizationModel}
                  onChange={(e) =>
                    onChangeSpecForm({
                      ...specForm,
                      monetizationModel: e.target.value as SpecDecisionForm['monetizationModel'],
                    })
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Subscription + Rewarded Ads Unlock">
                    Pro सब्सक्रिप्शन + रीवार्डेड ऐड से 1 बार वॉटरमार्क/इफेक्ट अनलॉक
                  </option>
                  <option value="Freemium + Pro Subscription (UPI AutoPay)">
                    सिर्फ़ Freemium + Pro सब्सक्रिप्शन (कोई विज्ञापन नहीं)
                  </option>
                  <option value="Free with Watermark + Template Credits">
                    फ्री बेसिक + प्रति टेम्पलेट/AI क्रेडिट पैक
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  AI फीचर्स क्लाउड पर या फोन पर [भरें]
                </label>
                <select
                  value={specForm.aiExecutionStrategy}
                  onChange={(e) =>
                    onChangeSpecForm({
                      ...specForm,
                      aiExecutionStrategy: e.target.value as SpecDecisionForm['aiExecutionStrategy'],
                    })
                  }
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                >
                  <option value="Hybrid (On-Device MediaPipe/TFLite + Cloud STT/TTS with Credit Limit)">
                    Hybrid: ऑन-डिवाइस (BG Remove/Face) + क्लाउड (Hindi Whisper STT/TTS)
                  </option>
                  <option value="100% On-Device ML (Zero Server Cost)">
                    100% ऑन-डिवाइस ML (TFLite / Whisper-Tiny ऑन-डिवाइस)
                  </option>
                  <option value="Cloud AI API Gateway (Whisper + Gemini + RIFE)">
                    क्लाउड AI API गेटवे (दैनिक क्रेडिट लिमिट के साथ)
                  </option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  1080p एक्सपोर्ट स्पीड टारगेट [भरें: टारगेट]
                </label>
                <input
                  type="text"
                  value={specForm.exportTargetSpeed}
                  onChange={(e) => onChangeSpecForm({ ...specForm, exportTargetSpeed: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  मिनिमम डिवाइस सपोर्ट [भरें: मिनिमम डिवाइस]
                </label>
                <input
                  type="text"
                  value={specForm.minDeviceSpec}
                  onChange={(e) => onChangeSpecForm({ ...specForm, minDeviceSpec: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  टीम साइज़ और स्किल्स [भरें]
                </label>
                <input
                  type="text"
                  value={specForm.teamSizeAndSkills}
                  onChange={(e) => onChangeSpecForm({ ...specForm, teamSizeAndSkills: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  बजट (डेवलपमेंट + सर्वर + AI API) [भरें]
                </label>
                <input
                  type="text"
                  value={specForm.budgetBreakdown}
                  onChange={(e) => onChangeSpecForm({ ...specForm, budgetBreakdown: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  इस ऐप को बाकी एडिटर्स से अलग क्या बनाएगा (USP) [भरें]
                </label>
                <textarea
                  rows={2}
                  value={specForm.coreUsp}
                  onChange={(e) => onChangeSpecForm({ ...specForm, coreUsp: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  नाम और लोगो का ट्रेडमार्क स्टेटस [भरें]
                </label>
                <input
                  type="text"
                  value={specForm.trademarkStatus}
                  onChange={(e) => onChangeSpecForm({ ...specForm, trademarkStatus: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Live Summary & Success Metrics Card */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-slate-100">
                2. गोल्स और सक्सेस मेट्रिक्स (Targets)
              </h3>
              <div className="space-y-3 text-xs text-slate-300">
                <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
                  <span className="text-slate-400">पहला वीडियो एक्सपोर्ट समय</span>
                  <span className="font-mono tabular-nums font-semibold text-amber-400">≤ 60 sec</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
                  <span className="text-slate-400">1080p 30fps रेंडर (1 मिनट क्लिप)</span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-400">45s – 90s</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
                  <span className="text-slate-400">क्रैश-फ्री सेशन रेट</span>
                  <span className="font-mono tabular-nums font-semibold text-sky-400">≥ 99.2%</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-800/80">
                  <span className="text-slate-400">शुरुआती APK / App साइज़</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-100">&lt; 65 MB</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-slate-400">चुने गए MVP/V2 फीचर्स</span>
                  <span className="font-mono tabular-nums font-semibold text-amber-400">
                    {specForm.selectedMvpFeatures.length} / {MVP_FEATURE_CHECKLIST.length}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-3">
              <h3 className="text-base font-semibold text-slate-100">
                11. अगला कदम: फेज़ 0 प्रोटोटाइप
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                इस वेब स्टूडियो में फेज़ 0 + MVP प्रोटोटाइप पहले से चालू है: आप गैलरी से वीडियो चुन सकते हैं, प्रीव्यू में चला सकते हैं, ट्रिम/स्प्लिट कर सकते हैं, देवनागरी/English टेक्स्ट जोड़ सकते हैं और असली वीडियो एक्सपोर्ट कर सकते हैं।
              </p>
              <button
                type="button"
                onClick={onOpenEditor}
                className="w-full min-h-[42px] py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>एडिटर में प्रोटोटाइप टेस्ट करें</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Feature Master Checklist (MVP / V2 / V3) */}
      {activeTab === 'features' && (
        <div className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                3. फीचर मास्टर लिस्ट — कौन-कौन से फीचर MVP में चाहिए (टिक करें)
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                नीचे की लिस्ट से अपने पहले रिलीज़ (MVP) और दूसरे चरण (V2) के फीचर्स चुनें।
              </p>
            </div>
            <div className="font-mono tabular-nums text-xs text-amber-400">
              चयनित: {specForm.selectedMvpFeatures.length} फीचर्स
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MVP_FEATURE_CHECKLIST.map((item) => {
              const checked = specForm.selectedMvpFeatures.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleMvpFeature(item.id)}
                  className={`p-4 rounded-lg border text-left transition-colors flex items-start gap-3 ${
                    checked
                      ? 'bg-slate-900/90 border-amber-500/50 text-slate-100'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <div className="text-xs text-slate-400">
                      <span>{item.section}</span>
                      <span className="mx-1.5">·</span>
                      <span className={item.phase === 'MVP' ? 'text-emerald-400 font-semibold' : 'text-sky-400 font-semibold'}>
                        {item.phase}
                      </span>
                    </div>
                    <div className="text-sm font-medium leading-snug">{item.labelHi}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Technical Architecture & Data Model */}
      {activeTab === 'architecture' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-slate-100">
                5.1 & 5.2 एडिटिंग इंजन आर्किटेक्चर
              </h2>
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-amber-400 text-xs mb-1">
                  1. डिकोडर / एनकोडर (Hardware MediaCodec + FFmpeg Fallback)
                </div>
                <p className="text-xs text-slate-400">
                  Android Media3 Transformer और हार्डवेयर SurfaceTexture डिकोडिंग ताकि 1080p/4K क्लिप्स बिना CPU ओवरहीटिंग के 30–60fps पर चलें।
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-sky-400 text-xs mb-1">
                  2. GPU कंपोज़िटर (OpenGL ES 3.0 / WebGL Shaders)
                </div>
                <p className="text-xs text-slate-400">
                  हर फ्रेम पर मल्टी-ट्रैक लेयर्स, क्रोमा की, मास्क, कलर ग्रेडिंग (HSL/LUT) और ट्रांज़िशन शेडर प्रोग्राम के ज़रिए रीयल-टाइम रेंडर।
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-emerald-400 text-xs mb-1">
                  3. ऑडियो मिक्सडाउन और वेवफॉर्म इंजन
                </div>
                <p className="text-xs text-slate-400">
                  मल्टी-ट्रैक PCM मिक्सिंग, ऑन-डिवाइस FFT बीट डिटेक्शन (ऑटो बीट-मार्क डॉट्स) और कम लेटेंसी माइक वॉइसओवर रिकॉर्डिंग।
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-5 h-5 text-sky-400" />
              <h2 className="text-lg font-semibold text-slate-100">
                5.3 JSON टाइमलाइन डेटा मॉडल (Serializable Project Graph)
              </h2>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed">
{`{
  "project": {
    "id": "proj-clipnova-mvp",
    "name": "${specForm.finalAppName}",
    "aspectRatio": "9:16",
    "fps": 30,
    "resolution": "1080p"
  },
  "tracks": ["video", "overlay", "text", "sticker", "audio"],
  "clipSchema": {
    "inPoint": 0.0,
    "outPoint": 4.5,
    "speed": 1.0,
    "filterPreset": "mumbai-gold",
    "effect": "cinematic-bars",
    "keyframes": [
      { "timeOffset": 0.0, "scale": 1.0, "easing": "ease-in-out" },
      { "timeOffset": 4.2, "scale": 1.12, "easing": "ease-in-out" }
    ]
  }
}`}
            </pre>
          </div>
        </div>
      )}

      {/* TAB 4: Roadmap, Legal & Risks */}
      {activeTab === 'roadmap' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">8. चरणबद्ध रोडमैप (Phased Execution Roadmap)</h2>
            <div className="divide-y divide-slate-800">
              {[
                {
                  phase: 'फेज़ 0 (प्रोटोटाइप)',
                  time: '3 से 5 हफ्ते',
                  desc: 'डिज़ाइन, UI मॉकअप, टेक स्टैक फाइनल, गैलरी से 1 वीडियो प्ले + ट्रिम + हिंदी टेक्स्ट + एक्सपोर्ट।',
                },
                {
                  phase: 'MVP (V1 लॉन्च)',
                  time: '4 से 6 महीने',
                  desc: 'मल्टी-ट्रैक टाइमलाइन, बेसिक टूल्स, देवनागरी टेक्स्ट, रॉयल्टी-फ्री म्यूज़िक, 20 इफेक्ट्स, 720p/1080p एक्सपोर्ट और वॉटरमार्क।',
                },
                {
                  phase: 'V2 (ग्रोथ और मॉनेटाइज़ेशन)',
                  time: '4 से 6 महीने',
                  desc: 'कीफ्रेम एनिमेशन, मास्क, क्रोमा की, हिंदी ऑटो-कैप्शन (Whisper), TTS, बैकग्राउंड रिमूवर, रेडीमेड टेम्पलेट और UPI AutoPay सब्सक्रिप्शन।',
                },
                {
                  phase: 'V3 (स्केल और इकोसिस्टम)',
                  time: '6+ महीने',
                  desc: 'मोशन ट्रैकिंग, AI स्टाइल, क्लाउड ड्राफ्ट सिंक, क्रिएटर टेम्पलेट मार्केटप्लेस और iOS रिलीज़।',
                },
              ].map((row, idx) => (
                <div key={idx} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-100">{row.phase}</div>
                    <div className="text-xs text-slate-400">{row.desc}</div>
                  </div>
                  <div className="font-mono tabular-nums text-xs text-amber-400 shrink-0">
                    {row.time}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 bg-[#0F1522] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-lg font-semibold text-slate-100">
                7. लीगल, लाइसेंसिंग और DPDP नियम
              </h2>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
              <li>
                • <strong className="text-slate-100">ओरिजिनल ब्रांड और UI:</strong> CapCut / TikTok / ByteDance का कोई भी कोड, लोगो, नाम या प्रॉपराइटरी एसेट इस्तेमाल नहीं किया गया है।
              </li>
              <li>
                • <strong className="text-slate-100">म्यूज़िक और साउंड:</strong> इन-ऐप लाइब्रेरी में केवल 100% रॉयल्टी-फ्री/सिंथेसाइज़्ड ट्रैक। यूज़र के लोकल ऑडियो इंपोर्ट पर कॉपीराइट ज़िम्मेदारी टर्म्स में स्पष्ट।
              </li>
              <li>
                • <strong className="text-slate-100">फॉन्ट लाइसेंस:</strong> Google Fonts Open Font License (Noto Sans Devanagari, Rozha One, Kalam, Outfit).
              </li>
              <li>
                • <strong className="text-slate-100">FFmpeg और LGPL:</strong> डायनामिक लिंकिंग और ओपन-सोर्स एट्रिब्यूशन नोटिस सेटिंग्स में शामिल।
              </li>
              <li>
                • <strong className="text-slate-100">भारत का DPDP एक्ट:</strong> वॉइस/फेस AI फीचर्स के लिए स्पष्ट ऑप्ट-इन सहमति और लोकल मीडिया प्राइवसी।
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
